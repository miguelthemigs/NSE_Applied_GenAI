import pandas as pd
import chromadb
import gc
import os
os.environ["TOKENIZERS_PARALLELISM"] = "false"
import json

from src.pipeline.events import stream_event
from importlib import import_module

from src.config.settings import EMBEDDING_BATCH_SIZE, RERANKER_BATCH_SIZE
from src.config.paths import VECTOR_CHECKPOINT
from src.config.response_quality import (
    LOW_INFORMATION_VALUE,
    RESPONSE_QUALITY_METADATA_KEY,
    RESPONSE_QUALITY_VERSION,
    response_quality,
)
from src.config.themes import (
    LOW_INFORMATION_THEME,
    METADATA_COLS,
    SOURCE_METADATA_ALIASES,
    THEME_EMBEDDING_DEFINITIONS,
)
from .embedding_models import (
    AVAILABLE_EMBEDDING_MODELS,
    DEFAULT_EMBEDDING_MODEL,
    describe_embedding_runtime,
    load_embedding_model,
    unload_embedding_models,
)
from .theme_classifier import (
    CLASSIFICATION_STATUS_BUILDING,
    CLASSIFICATION_STATUS_READY,
    ThemeClassificationConfig,
    classification_config,
    classify_theme_batch,
    embedding_classification_config,
    encode_theme_definitions,
    theme_definition_text,
)
from src.utils.model_device import describe_model_device, get_model_device
from src.utils.file_parsers import detect_sep, is_questionnaire_column

reranker_models = import_module("src.pipeline.03_retrieval.reranker_models")

VECTOR_SCHEMA_VERSION = 3


def _release_unused_torch_memory() -> None:
    gc.collect()
    try:
        import torch
    except ImportError:
        return

    try:
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except Exception:
        pass

    try:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _load_vector_checkpoint(
    csv_path: str,
    embedding_model: str,
    selected_columns: list,
    db_path: str,
    classification: ThemeClassificationConfig,
) -> int:
    """Return processed_count if a valid checkpoint exists for the same run, else 0."""
    if not VECTOR_CHECKPOINT.exists():
        return 0
    try:
        stat = os.stat(csv_path)
        meta = json.loads(VECTOR_CHECKPOINT.read_text(encoding="utf-8"))
        if meta.get("csv_size") != stat.st_size:
            return 0
        if abs(meta.get("csv_mtime", 0) - stat.st_mtime) > 2:
            return 0
        if meta.get("embedding_model") != embedding_model:
            return 0
        if meta.get("selected_columns") != selected_columns:
            return 0
        if meta.get("vector_schema_version") != VECTOR_SCHEMA_VERSION:
            return 0
        for key, value in classification.collection_metadata(
            status=CLASSIFICATION_STATUS_BUILDING
        ).items():
            if meta.get(key) != value:
                return 0
        try:
            collection = chromadb.PersistentClient(path=str(db_path)).get_collection(
                "survey_responses"
            )
            collection_metadata = getattr(collection, "metadata", None) or {}
            for key, value in classification.collection_metadata(
                status=CLASSIFICATION_STATUS_BUILDING
            ).items():
                if collection_metadata.get(key) != value:
                    return 0
            processed_count = int(meta.get("processed_count", 0))
            if processed_count < 0 or collection.count() < processed_count:
                return 0
        except Exception:
            return 0
        return processed_count
    except Exception:
        return 0


def _save_vector_checkpoint(meta: dict):
    try:
        VECTOR_CHECKPOINT.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[VECTOR CHECKPOINT] Warning: could not save: {e}")


def _clear_vector_checkpoint():
    try:
        if VECTOR_CHECKPOINT.exists():
            VECTOR_CHECKPOINT.unlink()
    except Exception:
        pass


def _collection_metadata(
    embedding_model: str,
    classification: ThemeClassificationConfig,
    *,
    status: str,
    include_hnsw_space: bool = True,
) -> dict:
    metadata = {
        "embedding_model": embedding_model,
        "vector_schema_version": VECTOR_SCHEMA_VERSION,
        "response_quality_version": RESPONSE_QUALITY_VERSION,
        "theme_embedding_confidence_margin": classification.ambiguity_score_margin,
        "theme_reranker_status": "not_run",
        **classification.collection_metadata(status=status),
    }
    if include_hnsw_space:
        metadata["hnsw:space"] = "cosine"
    return metadata


def _invalidate_insight_cache() -> None:
    import_module("src.pipeline.04_generation.cache").clear_insight_cache()


def _validate_classified_collection(
    collection,
    *,
    expected_count: int,
    classification: ThemeClassificationConfig,
) -> None:
    stored = collection.get(include=["metadatas"])
    ids = stored.get("ids") or []
    metadatas = stored.get("metadatas") or []
    if len(ids) != expected_count or len(metadatas) != expected_count:
        raise RuntimeError(
            "Vector build is incomplete: stored document count does not match "
            "the classified source document count."
        )
    for doc_id, metadata in zip(ids, metadatas):
        metadata = metadata or {}
        primary_theme = metadata.get("theme_primary")
        expected_candidates = (
            1
            if primary_theme == LOW_INFORMATION_THEME
            else classification.candidate_count
        )
        if (
            metadata.get("theme_classification_version")
            != classification.classification_version
            or metadata.get("theme_taxonomy_version")
            != classification.taxonomy_version
            or metadata.get("theme_embedding_model")
            != classification.embedding_model_id
            or metadata.get("theme_reranker_model")
            != classification.reranker_model_id
            or metadata.get("theme_ambiguity_score_margin")
            != classification.ambiguity_score_margin
            or metadata.get("theme_candidate_count") != expected_candidates
            or not primary_theme
        ):
            raise RuntimeError(
                f"Vector build is incomplete: document {doc_id} is missing a "
                "compatible persisted theme assignment."
            )
        for position in range(1, expected_candidates + 1):
            if not metadata.get(f"theme_candidate_{position}"):
                raise RuntimeError(
                    f"Vector build is incomplete: document {doc_id} is missing "
                    f"persisted candidate theme {position}."
                )


def _load_reranker_for_classification(
    classification: ThemeClassificationConfig,
    *,
    allow_model_download: bool,
):
    if classification.reranker_model_id == "disabled":
        return None
    return reranker_models.load_reranker_model(
        classification.reranker_model_id,
        allow_download=allow_model_download,
    )


def _classification_for_embedding_model(
    embedding_model: str,
) -> ThemeClassificationConfig:
    return embedding_classification_config(embedding_model)


def _reranker_classification_for_embedding_model(
    embedding_model: str,
    reranker_model_id: str,
) -> ThemeClassificationConfig:
    return classification_config(
        embedding_model,
        reranker_model_id=reranker_model_id,
    )


def vector_db_is_ready(db_path: str) -> bool:
    try:
        collection = chromadb.PersistentClient(path=str(db_path)).get_collection(
            "survey_responses"
        )
        metadata = getattr(collection, "metadata", None) or {}
        embedding_model = metadata.get("embedding_model")
        if not embedding_model:
            return False
        accepted = [_classification_for_embedding_model(embedding_model)]
        # A completed rerank pass rewrites the classification keys with the
        # reranker's config; the collection is still a ready vector DB.
        reranker_model = metadata.get("theme_reranker_model")
        if metadata.get("theme_reranker_status") == "ready" and reranker_model:
            accepted.append(
                _reranker_classification_for_embedding_model(
                    embedding_model, reranker_model
                )
            )
        return any(
            all(
                metadata.get(key) == value
                for key, value in expected.collection_metadata(
                    status=CLASSIFICATION_STATUS_READY
                ).items()
            )
            for expected in accepted
        )
    except Exception:
        return False


METADATA_ALIASES = SOURCE_METADATA_ALIASES


def _first_metadata_value(row, aliases):
    for col in aliases:
        if col in row and pd.notna(row[col]) and str(row[col]).strip():
            return str(row[col])
    return None


def build_metadata(row) -> dict:
    meta = {
        "question": str(row.get("question", "N/A")),
        RESPONSE_QUALITY_METADATA_KEY: response_quality(row.get("answer", "")),
    }
    for canonical_key, aliases in METADATA_ALIASES.items():
        value = _first_metadata_value(row, aliases)
        if value:
            meta[canonical_key] = value

    # Keep the original metadata too for debugging/backwards compatibility,
    # but the dashboard should use the canonical keys above.
    for col in METADATA_COLS:
        if col in row and pd.notna(row[col]) and str(row[col]).strip():
            meta[col.lower()] = str(row[col])
    return meta


def _candidate_rows_from_metadata(metadata: dict) -> list[dict]:
    candidate_count = int(metadata.get("theme_candidate_count", 0) or 0)
    candidates = []
    for position in range(1, candidate_count + 1):
        prefix = f"theme_candidate_{position}"
        theme_name = metadata.get(prefix)
        if not theme_name or theme_name == LOW_INFORMATION_THEME:
            continue
        candidates.append(
            {
                "theme": theme_name,
                "embedding_similarity": float(
                    metadata.get(f"{prefix}_embedding_similarity", 0.0)
                ),
                "embedding_distance": float(
                    metadata.get(f"{prefix}_embedding_distance", 1.0)
                ),
                "embedding_rank": int(
                    metadata.get(f"{prefix}_embedding_rank", position) or position
                ),
            }
        )
    return candidates


def _strip_candidate_fields(metadata: dict) -> dict:
    return {
        key: value
        for key, value in metadata.items()
        if not key.startswith("theme_candidate_")
    }


def _metadata_with_ranked_candidates(
    metadata: dict,
    *,
    ranked_candidates: list[dict],
    classification: ThemeClassificationConfig,
) -> dict:
    updated = _strip_candidate_fields(dict(metadata))
    updated.setdefault("theme_embedding_primary", metadata.get("theme_primary"))
    updated.setdefault(
        "theme_embedding_primary_score",
        metadata.get("theme_primary_score"),
    )
    updated.setdefault(
        "theme_embedding_score_margin",
        metadata.get("theme_score_margin"),
    )

    primary = ranked_candidates[0]
    if primary["theme"] == LOW_INFORMATION_THEME:
        updated.update(
            {
                "theme_primary": LOW_INFORMATION_THEME,
                "theme_primary_score": float(primary["score"]),
                "theme_primary_score_kind": classification.score_kind,
                "theme_ambiguous": False,
                "theme_score_margin": 1.0,
                "theme_candidate_count": 1,
                "theme_classification_method": classification.method,
                "theme_reranker_model": classification.reranker_model_id,
                "theme_ambiguity_score_margin": classification.ambiguity_score_margin,
                "theme_candidate_1": LOW_INFORMATION_THEME,
                "theme_candidate_1_score": float(primary["score"]),
                "theme_candidate_1_embedding_similarity": 0.0,
                "theme_candidate_1_embedding_distance": 1.0,
                "theme_candidate_1_embedding_rank": 0,
            }
        )
        return updated

    theme_candidates = [
        candidate
        for candidate in ranked_candidates
        if candidate["theme"] != LOW_INFORMATION_THEME
    ]
    margin = (
        float(theme_candidates[0]["score"] - theme_candidates[1]["score"])
        if len(theme_candidates) > 1
        else 1.0
    )
    updated.update(
        {
            "theme_primary": theme_candidates[0]["theme"],
            "theme_primary_score": float(theme_candidates[0]["score"]),
            "theme_primary_score_kind": classification.score_kind,
            "theme_ambiguous": False,
            "theme_score_margin": margin,
            "theme_candidate_count": len(theme_candidates),
            "theme_classification_method": classification.method,
            "theme_reranker_model": classification.reranker_model_id,
            "theme_classification_version": classification.classification_version,
            "theme_taxonomy_version": classification.taxonomy_version,
            "theme_ambiguity_score_margin": classification.ambiguity_score_margin,
        }
    )
    for position, candidate in enumerate(theme_candidates, start=1):
        prefix = f"theme_candidate_{position}"
        updated[prefix] = candidate["theme"]
        updated[f"{prefix}_score"] = float(candidate["score"])
        updated[f"{prefix}_embedding_similarity"] = float(
            candidate["embedding_similarity"]
        )
        updated[f"{prefix}_embedding_distance"] = float(
            candidate["embedding_distance"]
        )
        updated[f"{prefix}_embedding_rank"] = int(candidate["embedding_rank"])
    return updated


def apply_theme_reranker_stream(
    db_path="./survey_vector_db",
    *,
    reranker_model_id: str | None = None,
    allow_model_download: bool = True,
    max_documents: int | None = None,
):
    reranker_model = None
    try:
        client = chromadb.PersistentClient(path=str(db_path))
        collection = client.get_collection("survey_responses")
        collection_metadata = getattr(collection, "metadata", None) or {}
        embedding_model = collection_metadata.get("embedding_model")
        if not embedding_model:
            yield stream_event("error", code="error.backend", error="Vector database is missing embedding model metadata.")
            return

        selected_reranker = str(
            reranker_model_id or reranker_models.selected_reranker_model()
        ).strip()
        if not selected_reranker:
            yield stream_event("error", code="error.backend", error="Reranker model id is required.")
            return

        classification = _reranker_classification_for_embedding_model(
            embedding_model,
            selected_reranker,
        )
        stored = collection.get(include=["documents", "metadatas"])
        ids = stored.get("ids") or []
        documents = stored.get("documents") or []
        metadatas = stored.get("metadatas") or []
        rows = []
        for doc_id, document, metadata in zip(ids, documents, metadatas):
            metadata = metadata or {}
            if (
                metadata.get("theme_primary") == LOW_INFORMATION_THEME
                or not metadata.get("theme_ambiguous")
            ):
                continue
            candidates = _candidate_rows_from_metadata(metadata)
            if len(candidates) < 2:
                continue
            rows.append(
                {
                    "id": doc_id,
                    "document": str(document or ""),
                    "metadata": metadata,
                    "candidates": candidates,
                }
            )

        if max_documents is not None:
            rows = rows[: max(0, int(max_documents))]

        yield stream_event("progress", stage="process", message=f"Found {len(rows)} ambiguous responses to rerank with "
                f"{selected_reranker}.", progress=5, ambiguous_documents=len(rows))

        if not rows:
            collection.modify(
                metadata={
                    **collection_metadata,
                    "theme_reranker_status": "ready",
                    "theme_reranker_model": selected_reranker,
                    "theme_classification_method": classification.method,
                    "theme_ambiguity_score_margin": classification.ambiguity_score_margin,
                }
            )
            _invalidate_insight_cache()
            yield stream_event("success", message="No ambiguous responses needed reranking.", progress=100, reranked_documents=0)
            return

        yield stream_event("progress", stage="load", message=f"Loading reranker {selected_reranker}...", progress=10)
        reranker_model = reranker_models.load_reranker_model(
            selected_reranker,
            allow_download=allow_model_download,
        )

        batch_size = 32
        changed_primary = 0
        low_information_reassigned = 0
        still_ambiguous = 0
        processed = 0
        for start in range(0, len(rows), batch_size):
            batch = rows[start : start + batch_size]
            pairs = []
            for row in batch:
                row_candidates = [
                    *row["candidates"],
                    {
                        "theme": LOW_INFORMATION_THEME,
                        "embedding_similarity": 0.0,
                        "embedding_distance": 1.0,
                        "embedding_rank": 0,
                    },
                ]
                row["reranker_candidates"] = row_candidates
                for candidate in row_candidates:
                    pairs.append(
                        (
                            theme_definition_text(candidate["theme"]),
                            row["document"],
                        )
                    )

            raw_scores = reranker_model.predict(
                pairs,
                batch_size=RERANKER_BATCH_SIZE,
            )
            raw_scores = [float(score) for score in raw_scores]
            if len(raw_scores) != len(pairs):
                raise ValueError(
                    f"Reranker returned {len(raw_scores)} scores for "
                    f"{len(pairs)} candidate pairs."
                )

            offset = 0
            updated_metadatas = []
            update_ids = []
            for row in batch:
                candidates = []
                for candidate in row["reranker_candidates"]:
                    candidates.append(
                        {
                            **candidate,
                            "score": raw_scores[offset],
                        }
                    )
                    offset += 1
                ranked = sorted(
                    candidates,
                    key=lambda candidate: (
                        candidate["score"],
                        candidate["embedding_similarity"],
                    ),
                    reverse=True,
                )
                updated = _metadata_with_ranked_candidates(
                    row["metadata"],
                    ranked_candidates=ranked,
                    classification=classification,
                )
                if updated.get("theme_primary") != row["metadata"].get("theme_primary"):
                    changed_primary += 1
                if updated.get("theme_primary") == LOW_INFORMATION_THEME:
                    low_information_reassigned += 1
                if updated.get("theme_ambiguous"):
                    still_ambiguous += 1
                update_ids.append(row["id"])
                updated_metadatas.append(updated)

            collection.update(ids=update_ids, metadatas=updated_metadatas)
            processed += len(batch)
            progress = 10 + int(85 * (processed / len(rows)))
            yield stream_event("progress", stage="process", message=f"Reranked {processed}/{len(rows)} ambiguous responses...", progress=progress, reranked_documents=processed, changed_primary=changed_primary, low_information_reassigned=low_information_reassigned)

        collection.modify(
            metadata={
                **collection_metadata,
                "theme_reranker_status": "ready",
                "theme_reranker_model": selected_reranker,
                "theme_classification_method": classification.method,
                "theme_ambiguity_score_margin": classification.ambiguity_score_margin,
            }
        )
        _invalidate_insight_cache()
        yield stream_event("success", message="Theme reranking completed", progress=100, reranker_model=selected_reranker, reranked_documents=processed, changed_primary=changed_primary, low_information_reassigned=low_information_reassigned, still_ambiguous=still_ambiguous)
    except Exception as e:
        yield stream_event("error", code="error.backend", error=str(e))
    finally:
        reranker_model = None
        reranker_models.unload_reranker_models()


def build_vector_db(csv_path="data/anonymized_output.csv", db_path="./survey_vector_db"):
    if not os.path.exists(csv_path):
        raise Exception(f"Input file {csv_path} not found. Please anonymize first.")

    # 1. Config 
    CSV_SEP = detect_sep(csv_path)
    df_temp = pd.read_csv(csv_path, sep=CSV_SEP, nrows=1, encoding='utf-8-sig')
    ANSWER_COLS = [col for col in df_temp.columns if is_questionnaire_column(col)]
    COLLECTION = 'survey_responses'
    EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL
    BATCH_SIZE = EMBEDDING_BATCH_SIZE
    if EMBEDDING_MODEL not in AVAILABLE_EMBEDDING_MODELS:
        raise Exception(f"Unsupported embedding model: {EMBEDDING_MODEL}")

    # 2. Load
    print(f"Loading CSV from {csv_path}...")
    df = pd.read_csv(csv_path, sep=CSV_SEP, encoding='utf-8-sig')

    # Combine answers
    all_records = []
    for question_col in ANSWER_COLS:
        if question_col in df.columns:
            temp_df = df[df[question_col].notna()].copy()
            temp_df['question'] = question_col
            temp_df['answer'] = temp_df[question_col].astype(str)
            all_records.append(temp_df)
    
    if not all_records:
        raise Exception("No matching answer columns found in the dataset.")
        
    df_combined = pd.concat(all_records, ignore_index=True)

    classification = _classification_for_embedding_model(EMBEDDING_MODEL)
    print(f"Generating embeddings and theme assignments for {len(df_combined)} rows...")
    device = get_model_device()
    print(f"Loading embedding model on {describe_model_device(device)}...")
    model = load_embedding_model(EMBEDDING_MODEL)
    try:
        theme_names, theme_embeddings = encode_theme_definitions(model)

        print(f"Writing to ChromaDB at '{db_path}'...")
        client = chromadb.PersistentClient(path=db_path)

        try:
            client.delete_collection(COLLECTION)
        except:
            pass

        collection = client.create_collection(
            name=COLLECTION,
            metadata=_collection_metadata(
                EMBEDDING_MODEL,
                classification,
                status=CLASSIFICATION_STATUS_BUILDING,
            ),
        )

        for start in range(0, len(df_combined), BATCH_SIZE):
            end = min(start + BATCH_SIZE, len(df_combined))
            batch = df_combined.iloc[start:end]
            batch_docs = batch["answer"].tolist()
            batch_embeddings = model.encode(
                batch_docs,
                batch_size=BATCH_SIZE,
                normalize_embeddings=True,
            )
            assignments = classify_theme_batch(
                batch_docs,
                batch_embeddings,
                theme_names=theme_names,
                theme_embeddings=theme_embeddings,
                config=classification,
                reranker_model=None,
            )
            batch_metadata = []
            for (_, row), assignment in zip(batch.iterrows(), assignments):
                batch_metadata.append({**build_metadata(row), **assignment})

            collection.upsert(
                ids=[f"doc_{i}" for i in range(start, end)],
                embeddings=batch_embeddings.tolist(),
                documents=batch_docs,
                metadatas=batch_metadata,
            )
            del batch, batch_docs, batch_embeddings, assignments, batch_metadata
            _release_unused_torch_memory()

        _validate_classified_collection(
            collection,
            expected_count=len(df_combined),
            classification=classification,
        )
        collection.modify(
            metadata=_collection_metadata(
                EMBEDDING_MODEL,
                classification,
                status=CLASSIFICATION_STATUS_READY,
                include_hnsw_space=False,
            )
        )
        _invalidate_insight_cache()
        low_information_count = sum(
            response_quality(answer) == LOW_INFORMATION_VALUE
            for answer in df_combined["answer"]
        )
        return {
            "status": "success",
            "rows_embedded": len(df_combined),
            "low_information_responses": low_information_count,
        }
    finally:
        model = None
        unload_embedding_models()
        reranker_models.unload_reranker_models()

def build_vector_db_stream(
    csv_path="data/anonymized_survey.csv",
    db_path="./survey_vector_db",
    embedding_model=None,
    selected_columns=None,
    allow_model_download=True,
):
    if not os.path.exists(csv_path):
        yield stream_event("error", code="error.no_data", error=f"Input file {csv_path} not found. Please anonymize first.")
        return

    model = None
    try:
        CSV_SEP = detect_sep(csv_path)
        COLLECTION = 'survey_responses'
        EMBEDDING_MODEL = str(embedding_model or DEFAULT_EMBEDDING_MODEL).strip()
        classification = _classification_for_embedding_model(EMBEDDING_MODEL)
        BATCH_SIZE = EMBEDDING_BATCH_SIZE
        if EMBEDDING_MODEL not in AVAILABLE_EMBEDDING_MODELS:
            supported = ", ".join(AVAILABLE_EMBEDDING_MODELS)
            yield stream_event("error", code="error.model_missing", error=f"Unsupported embedding model '{EMBEDDING_MODEL}'. Choose one of: {supported}.")
            return

        # Load CSV
        yield stream_event("progress", stage="read", message=f"Loading CSV from {csv_path}...", progress=10)
        df = pd.read_csv(csv_path, sep=CSV_SEP, encoding='utf-8-sig')

        if selected_columns and len(selected_columns) > 0:
            ANSWER_COLS = [col for col in selected_columns if col in df.columns]
            yield stream_event("progress", stage="read", message=f"Using {len(ANSWER_COLS)} selected columns: {', '.join(ANSWER_COLS)}", progress=12)
        else:
            ANSWER_COLS = [col for col in df.columns if is_questionnaire_column(col)]

        if not ANSWER_COLS:
            yield stream_event("error", code="error.no_data", error="No matching columns found in the dataset.")
            return

        all_records = []
        for question_col in ANSWER_COLS:
            if question_col in df.columns:
                temp_df = df[df[question_col].notna()].copy()
                temp_df['question'] = question_col
                temp_df['answer'] = temp_df[question_col].astype(str)
                all_records.append(temp_df)

        if not all_records:
            yield stream_event("error", code="error.no_data", error="No matching answer columns found in the dataset.")
            return

        df_combined = pd.concat(all_records, ignore_index=True)
        total_docs = len(df_combined)

        # Check for a resumable checkpoint.
        resume_from = _load_vector_checkpoint(
            csv_path,
            EMBEDDING_MODEL,
            ANSWER_COLS,
            db_path,
            classification,
        )
        is_resuming = resume_from > 0

        if is_resuming:
            yield stream_event("progress", stage="read", message=f"Resuming from checkpoint — {resume_from}/{total_docs} documents already indexed...", progress=15)

        # Load/validate the model before touching ChromaDB.
        yield stream_event("progress", stage="load", message=f"Loading {EMBEDDING_MODEL} embedding model via {describe_embedding_runtime(EMBEDDING_MODEL)}...", progress=25)
        try:
            model = load_embedding_model(EMBEDDING_MODEL, allow_download=allow_model_download)
        except Exception as e:
            download_hint = (
                " Allow model download or choose a locally cached model."
                if not allow_model_download
                else " Check your internet connection, HF_TOKEN, or model name."
            )
            yield stream_event("error", code="error.download_failed" if allow_model_download else "error.model_missing", error=f"Embedding model could not be loaded: {e}.{download_hint}")
            return

        yield stream_event("progress", stage="process", message="Embedding-only theme assignment enabled; reranker can be run "
                "after vector indexing.", progress=27)

        yield stream_event("progress", stage="process", message=f"Embedding {len(THEME_EMBEDDING_DEFINITIONS)} theme definitions; "
                f"top {classification.candidate_count} candidates per response "
                f"will be stored. Rows with top-two margin <= "
                f"{classification.ambiguity_score_margin:g} stay ambiguous.", progress=29)
        theme_names, theme_embeddings = encode_theme_definitions(model)

        yield stream_event("progress", stage="save", message="Connecting to ChromaDB...", progress=30)
        client = chromadb.PersistentClient(path=str(db_path))

        if is_resuming:
            # Reuse the existing collection — do not delete it.
            collection = client.get_or_create_collection(
                COLLECTION,
                metadata=_collection_metadata(
                    EMBEDDING_MODEL,
                    classification,
                    status=CLASSIFICATION_STATUS_BUILDING,
                ),
            )
        else:
            try:
                client.delete_collection(COLLECTION)
            except Exception:
                pass
            collection = client.create_collection(
                COLLECTION,
                metadata=_collection_metadata(
                    EMBEDDING_MODEL,
                    classification,
                    status=CLASSIFICATION_STATUS_BUILDING,
                ),
            )

        yield stream_event("progress", stage="process", message=f"Found {total_docs} documents to embed and classify. Starting batched indexing...", progress=40)

        stat = os.stat(csv_path)
        checkpoint_meta = {
            "csv_size": stat.st_size,
            "csv_mtime": stat.st_mtime,
            "embedding_model": EMBEDDING_MODEL,
            "selected_columns": ANSWER_COLS,
            "total_docs": total_docs,
            "processed_count": resume_from,
            "vector_schema_version": VECTOR_SCHEMA_VERSION,
            **classification.collection_metadata(
                status=CLASSIFICATION_STATUS_BUILDING
            ),
        }

        processed_count = resume_from

        for start in range(resume_from, total_docs, BATCH_SIZE):
            end = min(start + BATCH_SIZE, total_docs)

            batch = df_combined.iloc[start:end]
            batch_docs = batch['answer'].tolist()
            # Deterministic IDs so resume can safely skip already-indexed batches.
            batch_ids = [f"doc_{start + j}" for j in range(len(batch))]
            batch_meta = [build_metadata(row) for _, row in batch.iterrows()]

            batch_embeddings = model.encode(
                batch_docs,
                batch_size=BATCH_SIZE,
                normalize_embeddings=True,
            )
            assignments = classify_theme_batch(
                batch_docs,
                batch_embeddings,
                theme_names=theme_names,
                theme_embeddings=theme_embeddings,
                config=classification,
                reranker_model=None,
            )
            batch_meta = [
                {**metadata, **assignment}
                for metadata, assignment in zip(batch_meta, assignments)
            ]

            collection.upsert(
                ids=batch_ids,
                documents=batch_docs,
                metadatas=batch_meta,
                embeddings=batch_embeddings.tolist()
            )

            processed_count = end
            checkpoint_meta["processed_count"] = processed_count
            _save_vector_checkpoint(checkpoint_meta)
            current_doc = str(batch_docs[-1])[:100] + "..." if batch_docs else ""
            del batch, batch_docs, batch_ids, batch_embeddings, assignments, batch_meta
            _release_unused_torch_memory()

            progress = 40 + int(55 * (processed_count / total_docs))
            yield stream_event("progress", stage="process", message=f"Embedded, classified, and indexed {processed_count}/{total_docs} documents...", progress=progress, current_doc=current_doc, checkpoint_saved=True)

        yield stream_event("progress", stage="save", message="Validating persisted theme assignments before marking the database ready...", progress=96)
        _validate_classified_collection(
            collection,
            expected_count=total_docs,
            classification=classification,
        )
        collection.modify(
            metadata=_collection_metadata(
                EMBEDDING_MODEL,
                classification,
                status=CLASSIFICATION_STATUS_READY,
                include_hnsw_space=False,
            )
        )
        _invalidate_insight_cache()
        _clear_vector_checkpoint()

        low_information_count = sum(
            response_quality(answer) == LOW_INFORMATION_VALUE
            for answer in df_combined["answer"]
        )
        yield stream_event("success", message="Vector DB built successfully", progress=100, document_count=total_docs, vectors_created=total_docs, theme_classification_version=classification.classification_version, theme_candidate_count=classification.candidate_count, theme_reranker_model=classification.reranker_model_id, theme_reranker_status="not_run", theme_ambiguity_score_margin=classification.ambiguity_score_margin, low_information_responses=low_information_count)

    except Exception as e:
        yield stream_event("error", code="error.backend", error=str(e))
    finally:
        if model is not None:
            model = None
        unload_embedding_models()
        reranker_models.unload_reranker_models()

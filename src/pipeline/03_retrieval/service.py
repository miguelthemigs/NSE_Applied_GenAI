import chromadb
from importlib import import_module

from src.config.paths import VECTOR_DB_PATH
from src.config.response_quality import (
    LOW_INFORMATION_VALUE,
    RESPONSE_QUALITY_METADATA_KEY,
    is_low_information_response,
)
from src.config.settings import RERANKER_CANDIDATE_MULTIPLIER, RERANKER_MAX_CANDIDATES
from src.config.themes import (
    LOW_INFORMATION_THEME,
    METADATA_ALIASES,
    THEMES_LIST,
)
embedding_models = import_module("src.pipeline.02_embedding.embedding_models")
reranker_models = import_module("src.pipeline.03_retrieval.reranker_models")
theme_classifier = import_module("src.pipeline.02_embedding.theme_classifier")

DEFAULT_EMBEDDING_MODEL = embedding_models.DEFAULT_EMBEDDING_MODEL
describe_embedding_runtime = embedding_models.describe_embedding_runtime
load_embedding_model = embedding_models.load_embedding_model
describe_reranker_runtime = reranker_models.describe_reranker_runtime
load_reranker_model = reranker_models.load_reranker_model
reranker_enabled = reranker_models.reranker_enabled
selected_reranker_model = reranker_models.selected_reranker_model

COLLECTION_NAME = "survey_responses"
THEME_EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL

_theme_overview_cache = {}
_theme_embedding_models = {}
_collection = None
_classification_metadata: dict | None = None
_filter_options_cache: dict | None = None
_filter_options_filtered_cache: dict[str, dict] = {}
_vector_stats_cache: dict | None = None


def metadata_value(meta: dict, canonical_key: str):
    for key in METADATA_ALIASES.get(canonical_key, [canonical_key]):
        value = meta.get(key)
        if value is not None and str(value).strip():
            return value
    return None


def filter_condition(canonical_key: str, value: str):
    aliases = METADATA_ALIASES.get(canonical_key, [canonical_key])
    conditions = [{key: value} for key in aliases]
    if len(conditions) == 1:
        return conditions[0]
    return {"$or": conditions}


def build_where_filter(filters: dict):
    if not filters:
        return None
    conditions = [filter_condition(key, value) for key, value in filters.items()]
    if len(conditions) == 1:
        return conditions[0]
    return {"$and": conditions}


def _combine_where(*clauses):
    active = [clause for clause in clauses if clause]
    if not active:
        return None
    if len(active) == 1:
        return active[0]
    return {"$and": active}


def filtered_response_rows(collection, where_filter=None) -> list[dict]:
    get_kwargs = {"include": ["documents", "metadatas"]}
    if where_filter:
        get_kwargs["where"] = where_filter
    result = collection.get(**get_kwargs)
    ids = result.get("ids") or []
    documents = result.get("documents") or []
    metadatas = result.get("metadatas") or []

    rows = []
    for index, doc_id in enumerate(ids):
        document = documents[index] if index < len(documents) else ""
        metadata = metadatas[index] if index < len(metadatas) else {}
        metadata = metadata or {}
        is_low_information = (
            metadata.get(RESPONSE_QUALITY_METADATA_KEY) == LOW_INFORMATION_VALUE
            or is_low_information_response(document)
        )
        rows.append(
            {
                "id": doc_id,
                "document": str(document or ""),
                "metadata": metadata,
                "is_low_information": is_low_information,
            }
        )
    return rows


def _candidate_metrics(metadata: dict, theme_name: str) -> tuple[float, float]:
    candidate_count = int(metadata.get("theme_candidate_count", 0) or 0)
    for position in range(1, candidate_count + 1):
        prefix = f"theme_candidate_{position}"
        if metadata.get(prefix) == theme_name:
            score = float(metadata.get(f"{prefix}_score", 0.0))
            distance = float(
                metadata.get(f"{prefix}_embedding_distance", 1.0)
            )
            return score, distance
    return float(metadata.get("theme_primary_score", 0.0)), 1.0


def _get_evidence_rows(
    collection,
    where_clause,
    *,
    theme_name: str,
    evidence_type: str,
) -> list[dict]:
    result = collection.get(
        where=where_clause,
        include=["documents", "metadatas"],
    )
    ids = result.get("ids") or []
    documents = result.get("documents") or []
    metadatas = result.get("metadatas") or []
    rows = []
    for index, doc_id in enumerate(ids):
        document = documents[index] if index < len(documents) else ""
        metadata = metadatas[index] if index < len(metadatas) else {}
        metadata = metadata or {}
        score, distance = _candidate_metrics(metadata, theme_name)
        rows.append(
            {
                "id": doc_id,
                "document": str(document or ""),
                "metadata": metadata,
                "distance": distance,
                "classification_score": score,
                "evidence_type": evidence_type,
            }
        )
    rows.sort(
        key=lambda row: (
            row["classification_score"],
            -row["distance"],
        ),
        reverse=True,
    )
    return rows


def clear_runtime_caches():
    global _collection, _classification_metadata, _filter_options_cache, _filter_options_filtered_cache, _vector_stats_cache
    _theme_overview_cache.clear()
    _filter_options_filtered_cache.clear()
    _collection = None
    _classification_metadata = None
    _filter_options_cache = None
    _vector_stats_cache = None


def theme_overview_cache_key(filters: dict) -> tuple:
    return tuple(sorted(filters.items()))


def collection_embedding_model(collection) -> str:
    metadata = getattr(collection, "metadata", None) or {}
    return metadata.get("embedding_model") or THEME_EMBEDDING_MODEL


def get_theme_embedding_model(model_id: str | None = None):
    selected_model = model_id or THEME_EMBEDDING_MODEL
    if selected_model not in _theme_embedding_models:
        print(
            f"[EMBEDDINGS] Loading {selected_model} via "
            f"{describe_embedding_runtime(selected_model)}"
        )
        _theme_embedding_models[selected_model] = load_embedding_model(selected_model)
    return _theme_embedding_models[selected_model]


def current_reranker_id():
    return selected_reranker_model() if reranker_enabled() else None


def expected_classification_config(embedding_model_id: str):
    return theme_classifier.embedding_classification_config(embedding_model_id)


class ClassificationNotReady(RuntimeError):
    """The vector DB lacks a compatible persisted theme classification."""


def validate_theme_classification(collection):
    metadata = getattr(collection, "metadata", None) or {}
    embedding_model_id = collection_embedding_model(collection)
    expected = expected_classification_config(embedding_model_id)
    expected_metadata = expected.collection_metadata(
        status=theme_classifier.CLASSIFICATION_STATUS_READY
    )
    required_keys = {
        "theme_classification_status",
        "theme_classification_version",
        "theme_taxonomy_version",
        "theme_candidate_count",
        "theme_embedding_model",
    }
    mismatches = [
        key
        for key, expected_value in expected_metadata.items()
        if key in required_keys
        if metadata.get(key) != expected_value
    ]
    if metadata.get("embedding_model") != embedding_model_id:
        mismatches.append("embedding_model")
    if mismatches:
        mismatch_list = ", ".join(sorted(set(mismatches)))
        raise ClassificationNotReady(
            "Vector database is missing compatible persisted theme "
            f"classification ({mismatch_list}). Delete it and run a fresh "
            "vector build before generating dashboard summaries."
        )
    return expected


def _persisted_classification_metadata(collection, config) -> dict:
    metadata = getattr(collection, "metadata", None) or {}
    result = config.cache_metadata()
    for key in list(result):
        if key in metadata:
            result[key] = metadata[key]
    for key in (
        "theme_embedding_confidence_margin",
        "theme_reranker_status",
    ):
        if key in metadata:
            result[key] = metadata[key]
    return result


def classification_cache_metadata(collection=None) -> dict:
    global _classification_metadata
    if collection is None and _classification_metadata is not None:
        return _classification_metadata
    selected_collection = collection or get_collection()
    config = validate_theme_classification(selected_collection)
    result = _persisted_classification_metadata(selected_collection, config)
    if collection is None:
        _classification_metadata = result
    return result


def rerank_documents(
    query: str,
    documents: list[str],
    *,
    metadatas: list[dict] | None = None,
    distances: list[float] | None = None,
    top_n: int | None = None,
    allow_model_download: bool = True,
) -> list[dict]:
    if not documents:
        return []

    if not reranker_enabled():
        ranked = []
        for i, doc in enumerate(documents):
            distance = distances[i] if distances and i < len(distances) else None
            similarity = max(0, 1 - distance) if distance is not None else None
            ranked.append(
                {
                    "document": doc,
                    "metadata": metadatas[i] if metadatas and i < len(metadatas) else {},
                    "distance": distance,
                    "similarity": similarity,
                    "reranker_score": None,
                }
            )
        return ranked[:top_n] if top_n else ranked

    model_id = selected_reranker_model()
    print(f"[RERANKER] Loading {model_id} via {describe_reranker_runtime(model_id)}")
    model = load_reranker_model(model_id, allow_download=allow_model_download)
    scores = model.predict([(query, doc) for doc in documents])

    ranked = []
    for i, (doc, score) in enumerate(zip(documents, scores)):
        distance = distances[i] if distances and i < len(distances) else None
        similarity = max(0, 1 - distance) if distance is not None else None
        ranked.append(
            {
                "document": doc,
                "metadata": metadatas[i] if metadatas and i < len(metadatas) else {},
                "distance": distance,
                "similarity": similarity,
                "reranker_score": float(score),
            }
        )

    ranked.sort(key=lambda item: item["reranker_score"], reverse=True)
    return ranked[:top_n] if top_n else ranked


def get_collection():
    global _collection
    if _collection is not None:
        return _collection
    _collection = chromadb.PersistentClient(path=str(VECTOR_DB_PATH)).get_collection(
        COLLECTION_NAME
    )
    validate_theme_classification(_collection)
    return _collection


def filter_options_payload() -> dict:
    global _filter_options_cache
    if _filter_options_cache is not None:
        return _filter_options_cache
    try:
        collection = get_collection()
    except Exception:
        return {"status": "empty", "options": {}}

    all_docs = collection.get(limit=collection.count())
    buckets = {
        "institutions": set(),
        "academic_years": set(),
        "locations": set(),
        "programmes": set(),
        "study_modes": set(),
        "cohorts": set(),
        "sectors": set(),
        "languages": set(),
    }
    bucket_keys = {
        "institutions": "institution",
        "academic_years": "academic_year",
        "locations": "location",
        "programmes": "programme",
        "study_modes": "study_mode",
        "cohorts": "cohort",
        "sectors": "sector",
        "languages": "language",
    }

    for meta in all_docs.get("metadatas") or []:
        for bucket, canonical_key in bucket_keys.items():
            value = metadata_value(meta, canonical_key)
            if value:
                buckets[bucket].add(str(value))

    _filter_options_cache = {
        "status": "success",
        "options": {key: sorted(values) for key, values in buckets.items()},
    }
    return _filter_options_cache


def filter_options_for_selection(filters: dict) -> dict:
    """Return only the filter options that exist in documents matching the given filters."""
    global _filter_options_filtered_cache
    if not filters:
        return filter_options_payload()
    cache_key = str(sorted(filters.items()))
    if cache_key in _filter_options_filtered_cache:
        return _filter_options_filtered_cache[cache_key]
    try:
        collection = get_collection()
    except Exception:
        return {"status": "empty", "options": {}}
    where_clause = build_where_filter(filters)
    result = collection.get(where=where_clause, include=["metadatas"])
    buckets: dict[str, set] = {
        "institutions": set(), "academic_years": set(), "locations": set(),
        "programmes": set(), "study_modes": set(), "cohorts": set(),
        "sectors": set(), "languages": set(),
    }
    bucket_keys = {
        "institutions": "institution", "academic_years": "academic_year",
        "locations": "location", "programmes": "programme",
        "study_modes": "study_mode", "cohorts": "cohort",
        "sectors": "sector", "languages": "language",
    }
    for meta in result.get("metadatas") or []:
        for bucket, canonical_key in bucket_keys.items():
            value = metadata_value(meta, canonical_key)
            if value:
                buckets[bucket].add(str(value))
    payload = {
        "status": "success",
        "options": {key: sorted(values) for key, values in buckets.items()},
    }
    _filter_options_filtered_cache[cache_key] = payload
    return payload


def query_vectors_payload(query_text: str, top_k: int, filters: dict) -> dict:
    if not query_text:
        raise ValueError("Empty query")

    print(f"[QUERY] Searching: '{query_text}' | Filters: {filters}")
    collection = get_collection()
    embedding_model = collection_embedding_model(collection)
    model = get_theme_embedding_model(embedding_model)
    query_embedding = model.encode(query_text, normalize_embeddings=True)
    where_filter = build_where_filter(filters)

    retrieval_k = min(
        max(top_k * RERANKER_CANDIDATE_MULTIPLIER, top_k),
        max(collection.count(), 1),
        RERANKER_MAX_CANDIDATES,
    )
    results = collection.query(
        query_embeddings=[query_embedding.tolist()],
        n_results=retrieval_k,
        where=where_filter,
        include=["documents", "metadatas", "distances"],
    )

    formatted = []
    if results["documents"] and len(results["documents"]) > 0:
        ranked_results = rerank_documents(
            query_text,
            results["documents"][0],
            metadatas=results["metadatas"][0] if results["metadatas"] else None,
            distances=results["distances"][0] if results["distances"] else None,
            top_n=top_k,
        )
        for i, ranked in enumerate(ranked_results):
            doc = ranked["document"]
            similarity = ranked["similarity"] if ranked["similarity"] is not None else 0
            result_item = {
                "id": i + 1,
                "document": doc,
                "preview": doc[:300] + "..." if len(doc) > 300 else doc,
                "similarity": round(similarity, 3),
                "percentage": round(similarity * 100, 1),
                "reranker_score": ranked["reranker_score"],
            }
            if ranked["metadata"]:
                result_item["metadata"] = ranked["metadata"]
            formatted.append(result_item)

    return {
        "status": "success",
        "results": formatted,
        "count": len(formatted),
        "candidate_count": len(results["documents"][0]) if results["documents"] else 0,
        "reranker": current_reranker_id(),
        "query": query_text,
        "filters_applied": filters,
    }


def vector_stats_payload() -> dict:
    global _vector_stats_cache
    if _vector_stats_cache is not None:
        return _vector_stats_cache
    try:
        collection = get_collection()
    except Exception:
        return {
            "status": "empty",
            "data": [],
            "total_documents": 0,
            "message": "Vector DB not initialized",
        }

    count = collection.count()
    if count == 0:
        return {"status": "empty", "data": [], "total_documents": 0}

    all_docs = collection.get(limit=min(count, 50))
    documents = []
    for i, doc in enumerate((all_docs.get("documents") or [])[:50]):
        documents.append(
            {
                "id": i + 1,
                "text": doc[:200] + "..." if len(doc) > 200 else doc,
                "full_text": doc,
                "metadata": all_docs["metadatas"][i] if all_docs.get("metadatas") else {},
            }
        )

    _vector_stats_cache = {
        "status": "success",
        "data": documents,
        "total_documents": count,
        "samples": len(documents),
    }
    return _vector_stats_cache


def percentages_from_counts(counts: dict[str, int]) -> dict[str, int]:
    total = sum(max(0, int(counts.get(theme, 0))) for theme in THEMES_LIST)
    if total <= 0:
        return {theme: 0 for theme in THEMES_LIST}

    raw = {
        theme: (max(0, int(counts.get(theme, 0))) * 100) / total
        for theme in THEMES_LIST
    }
    percentages = {theme: int(raw[theme]) for theme in THEMES_LIST}
    remainder = 100 - sum(percentages.values())
    by_fraction = sorted(
        THEMES_LIST,
        key=lambda theme: (raw[theme] - percentages[theme], counts.get(theme, 0)),
        reverse=True,
    )
    for theme in by_fraction[:remainder]:
        percentages[theme] += 1
    return percentages


def theme_distribution(collection, model_id: str | None = None, where_filter=None) -> dict:
    del model_id
    validate_theme_classification(collection)
    response_rows = filtered_response_rows(collection, where_filter)
    total_docs = len(response_rows)
    counts = {theme: 0 for theme in THEMES_LIST}
    if total_docs <= 0:
        return {
            "counts": counts,
            "percentages": percentages_from_counts(counts),
            "total_docs": 0,
        }

    for row in response_rows:
        primary_theme = row["metadata"].get("theme_primary")
        if primary_theme not in counts:
            raise RuntimeError(
                f"Document {row['id']} has an invalid persisted primary theme."
            )
        counts[primary_theme] += 1

    return {
        "counts": counts,
        "percentages": percentages_from_counts(counts),
        "total_docs": total_docs,
    }


def collect_theme_documents(
    collection,
    theme_name: str,
    *,
    filters: dict | None = None,
    model_id: str | None = None,
) -> dict:
    """Collect persisted definite and ambiguous evidence for one predefined theme."""
    del model_id
    classification = validate_theme_classification(collection)
    where_filter = build_where_filter(filters or {})
    distribution = theme_distribution(collection, where_filter=where_filter)
    total_docs = distribution["total_docs"]
    counts = distribution["counts"]
    percentages = distribution["percentages"]
    if total_docs <= 0:
        return {
            "frequency": 0,
            "vector_relevant_count": 0,
            "total_filtered_documents": 0,
            "documents": [],
            "metadatas": [],
            "distances": [],
            "evidence": [],
            "definite_documents": [],
            "ambiguous_documents": [],
            "counts": counts,
            "percentages": percentages_from_counts(counts),
        }

    if theme_name not in THEMES_LIST:
        raise ValueError(f"Unknown predefined theme: {theme_name}")

    definite_clause = _combine_where(
        where_filter,
        {"theme_primary": theme_name},
        {"theme_ambiguous": False},
    )
    definite_rows = _get_evidence_rows(
        collection,
        definite_clause,
        theme_name=theme_name,
        evidence_type="definite",
    )

    ambiguous_rows = []
    if theme_name != LOW_INFORMATION_THEME:
        candidate_conditions = [
            {f"theme_candidate_{position}": theme_name}
            for position in range(1, classification.candidate_count + 1)
        ]
        ambiguous_clause = _combine_where(
            where_filter,
            {"theme_ambiguous": True},
            (
                candidate_conditions[0]
                if len(candidate_conditions) == 1
                else {"$or": candidate_conditions}
            ),
        )
        ambiguous_rows = _get_evidence_rows(
            collection,
            ambiguous_clause,
            theme_name=theme_name,
            evidence_type="ambiguous",
        )

    selected_rows = definite_rows + ambiguous_rows
    return {
        "frequency": percentages.get(theme_name, 0),
        "vector_relevant_count": counts.get(theme_name, 0),
        "total_filtered_documents": total_docs,
        "documents": [row["document"] for row in selected_rows],
        "metadatas": [row["metadata"] for row in selected_rows],
        "distances": [row["distance"] for row in selected_rows],
        "evidence": selected_rows,
        "definite_documents": [row["document"] for row in definite_rows],
        "ambiguous_documents": [row["document"] for row in ambiguous_rows],
        "counts": counts,
        "percentages": percentages,
    }


def collect_documents_by_query(
    collection,
    query_text: str,
    *,
    filters: dict | None = None,
    model_id: str | None = None,
    n_results: int = 500,
) -> dict:
    """Direct vector search for a query string — used for subtheme drilldowns."""
    where_filter = build_where_filter(filters or {})
    response_rows = filtered_response_rows(collection, where_filter)
    total_docs = len(response_rows)
    if total_docs <= 0:
        return {"frequency": 0, "vector_relevant_count": 0, "total_filtered_documents": 0, "documents": [], "metadatas": [], "distances": []}

    substantive_ids = {
        row["id"] for row in response_rows if not row["is_low_information"]
    }
    if not substantive_ids:
        return {"frequency": 0, "vector_relevant_count": 0, "total_filtered_documents": total_docs, "documents": [], "metadatas": [], "distances": []}

    selected_model = model_id or collection_embedding_model(collection)
    model = get_theme_embedding_model(selected_model)
    query_embedding = model.encode(query_text, normalize_embeddings=True)

    k = min(
        max(n_results * RERANKER_CANDIDATE_MULTIPLIER, n_results),
        max(total_docs, 1),
        RERANKER_MAX_CANDIDATES,
    )
    results = collection.query(
        query_embeddings=[query_embedding.tolist()],
        n_results=k,
        where=where_filter,
        include=["documents", "metadatas", "distances"],
    )
    documents = results.get("documents", [[]])[0] if results.get("documents") else []
    metadatas = results.get("metadatas", [[]])[0] if results.get("metadatas") else []
    distances = results.get("distances", [[]])[0] if results.get("distances") else []
    ids = results.get("ids", [[]])[0] if results.get("ids") else []
    substantive_results = [
        (document, metadata, distance)
        for doc_id, document, metadata, distance in zip(
            ids, documents, metadatas, distances
        )
        if doc_id in substantive_ids
    ]
    ranked_results = rerank_documents(
        query_text,
        [row[0] for row in substantive_results],
        metadatas=[row[1] for row in substantive_results],
        distances=[row[2] for row in substantive_results],
        top_n=n_results,
    )
    return {
        "frequency": 0,
        "vector_relevant_count": len(ranked_results),
        "total_filtered_documents": total_docs,
        "documents": [row["document"] for row in ranked_results],
        "metadatas": [row["metadata"] for row in ranked_results],
        "distances": [row["distance"] for row in ranked_results],
    }


def filtered_themes_overview(cache: dict, filters: dict) -> dict:
    if not filters:
        return cache

    cache_key = theme_overview_cache_key(filters)
    if cache_key in _theme_overview_cache:
        return _theme_overview_cache[cache_key]

    collection = get_collection()
    where_clause = build_where_filter(filters)
    filtered_docs = collection.get(where=where_clause)
    total_docs = len(filtered_docs["ids"]) if filtered_docs and filtered_docs["ids"] else 0

    import copy

    new_cache = copy.deepcopy(cache)
    if total_docs == 0:
        for theme in new_cache:
            new_cache[theme]["frequency"] = 0
            new_cache[theme]["vector_relevant_count"] = 0
            new_cache[theme]["document_count"] = 0
        _theme_overview_cache[cache_key] = new_cache
        return new_cache

    distribution = theme_distribution(
        collection,
        collection_embedding_model(collection),
        where_filter=where_clause,
    )
    for theme_name in THEMES_LIST:
        if theme_name not in new_cache:
            continue
        new_cache[theme_name]["frequency"] = distribution["percentages"].get(theme_name, 0)
        new_cache[theme_name]["vector_relevant_count"] = distribution["counts"].get(
            theme_name, 0
        )

    _theme_overview_cache[cache_key] = new_cache
    return new_cache


def count_filtered_documents(filters: dict | None = None) -> int:
    collection = get_collection()
    where_clause = build_where_filter(filters or {})
    if not where_clause:
        return collection.count()
    filtered_docs = collection.get(where=where_clause)
    return len(filtered_docs["ids"]) if filtered_docs and filtered_docs["ids"] else 0


def filter_valid_combos(combos: list[dict]) -> list[dict]:
    """Return only combos that have ≥1 matching document.

    Uses one bulk metadata fetch + Python-side index, so N combos cost one
    ChromaDB round-trip instead of N.
    """
    if not combos:
        return []
    try:
        collection = get_collection()
    except Exception:
        return combos

    all_meta = collection.get(include=["metadatas"]).get("metadatas") or []
    if not all_meta:
        return []

    # Build per-dimension inverted index: {canonical_key: {value: {doc_indices}}}
    combo_keys = {key for combo in combos for key in combo}
    dimension_index: dict[str, dict[str, set]] = {}
    for idx, meta in enumerate(all_meta):
        for canonical_key in combo_keys:
            value = metadata_value(meta, canonical_key)
            if value:
                dimension_index.setdefault(canonical_key, {}).setdefault(str(value), set()).add(idx)

    all_indices = set(range(len(all_meta)))
    valid: list[dict] = []
    for combo in combos:
        if not combo:
            valid.append(combo)
            continue
        intersection = all_indices.copy()
        for key, value in combo.items():
            intersection &= dimension_index.get(key, {}).get(str(value), set())
            if not intersection:
                break
        if intersection:
            valid.append(combo)
    return valid

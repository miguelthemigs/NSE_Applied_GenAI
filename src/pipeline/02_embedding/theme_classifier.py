from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from src.config.response_quality import is_low_information_response
from src.config.settings import (
    RERANKER_BATCH_SIZE,
    THEME_AMBIGUITY_SCORE_MARGIN,
    THEME_CLASSIFICATION_CANDIDATES,
    THEME_EMBEDDING_CONFIDENCE_MARGIN,
)
from src.config.themes import (
    LOW_INFORMATION_THEME,
    THEME_CLASSIFICATION_VERSION,
    THEME_EMBEDDING_DEFINITIONS,
    THEME_RETRIEVAL_PROMPT,
    THEME_TAXONOMY_VERSION,
)


CLASSIFICATION_STATUS_BUILDING = "building"
CLASSIFICATION_STATUS_READY = "ready"
RERANKER_DISABLED_ID = "disabled"
MAX_THEME_CANDIDATES = len(THEME_EMBEDDING_DEFINITIONS)


@dataclass(frozen=True)
class ThemeClassificationConfig:
    embedding_model_id: str
    reranker_model_id: str
    candidate_count: int
    ambiguity_score_margin: float
    classification_version: int = THEME_CLASSIFICATION_VERSION
    taxonomy_version: int = THEME_TAXONOMY_VERSION

    @property
    def method(self) -> str:
        if self.reranker_model_id == RERANKER_DISABLED_ID:
            return "embedding_cosine_fallback"
        return "cross_encoder_reranker"

    @property
    def score_kind(self) -> str:
        if self.reranker_model_id == RERANKER_DISABLED_ID:
            return "cosine_similarity"
        return "raw_cross_encoder_score"

    def collection_metadata(self, *, status: str) -> dict:
        return {
            "theme_classification_status": status,
            "theme_classification_version": self.classification_version,
            "theme_taxonomy_version": self.taxonomy_version,
            "theme_candidate_count": self.candidate_count,
            "theme_ambiguity_score_margin": self.ambiguity_score_margin,
            "theme_embedding_model": self.embedding_model_id,
            "theme_reranker_model": self.reranker_model_id,
            "theme_classification_method": self.method,
        }

    def cache_metadata(self) -> dict:
        metadata = self.collection_metadata(status=CLASSIFICATION_STATUS_READY)
        metadata.pop("theme_classification_status")
        return metadata


def classification_config(
    embedding_model_id: str,
    *,
    reranker_model_id: str | None,
    candidate_count: int = THEME_CLASSIFICATION_CANDIDATES,
    ambiguity_score_margin: float = THEME_AMBIGUITY_SCORE_MARGIN,
) -> ThemeClassificationConfig:
    candidate_count = int(candidate_count)
    if not 1 <= candidate_count <= MAX_THEME_CANDIDATES:
        raise ValueError(
            "THEME_CLASSIFICATION_CANDIDATES must be between 1 and "
            f"{MAX_THEME_CANDIDATES}."
        )
    ambiguity_score_margin = float(ambiguity_score_margin)
    if ambiguity_score_margin < 0:
        raise ValueError("THEME_AMBIGUITY_SCORE_MARGIN must be non-negative.")
    return ThemeClassificationConfig(
        embedding_model_id=str(embedding_model_id).strip(),
        reranker_model_id=(
            str(reranker_model_id).strip()
            if reranker_model_id
            else RERANKER_DISABLED_ID
        ),
        candidate_count=candidate_count,
        ambiguity_score_margin=ambiguity_score_margin,
    )


def embedding_classification_config(
    embedding_model_id: str,
    *,
    candidate_count: int = THEME_CLASSIFICATION_CANDIDATES,
    confidence_margin: float = THEME_EMBEDDING_CONFIDENCE_MARGIN,
) -> ThemeClassificationConfig:
    return classification_config(
        embedding_model_id,
        reranker_model_id=None,
        candidate_count=candidate_count,
        ambiguity_score_margin=confidence_margin,
    )


def theme_definition_text(theme_name: str) -> str:
    definition = THEME_EMBEDDING_DEFINITIONS[theme_name]
    return f"{theme_name}. {definition}"


def encode_theme_definitions(embedding_model) -> tuple[list[str], np.ndarray]:
    theme_names = list(THEME_EMBEDDING_DEFINITIONS)
    embeddings = embedding_model.encode(
        [theme_definition_text(theme) for theme in theme_names],
        prompt=THEME_RETRIEVAL_PROMPT,
        normalize_embeddings=True,
    )
    return theme_names, np.asarray(embeddings, dtype=np.float32)


def _low_information_metadata(config: ThemeClassificationConfig) -> dict:
    return {
        "theme_primary": LOW_INFORMATION_THEME,
        "theme_primary_score": 1.0,
        "theme_primary_score_kind": "deterministic_rule",
        "theme_ambiguous": False,
        "theme_score_margin": 1.0,
        "theme_candidate_count": 1,
        "theme_classification_method": "response_quality_rule",
        "theme_embedding_model": config.embedding_model_id,
        "theme_reranker_model": config.reranker_model_id,
        "theme_classification_version": config.classification_version,
        "theme_taxonomy_version": config.taxonomy_version,
        "theme_ambiguity_score_margin": config.ambiguity_score_margin,
        "theme_candidate_1": LOW_INFORMATION_THEME,
        "theme_candidate_1_score": 1.0,
        "theme_candidate_1_embedding_similarity": 0.0,
        "theme_candidate_1_embedding_distance": 1.0,
        "theme_candidate_1_embedding_rank": 1,
    }


def classify_theme_batch(
    documents: list[str],
    document_embeddings,
    *,
    theme_names: list[str],
    theme_embeddings,
    config: ThemeClassificationConfig,
    reranker_model=None,
) -> list[dict]:
    """Classify one embedding batch and run at most one reranker prediction call."""
    if len(documents) == 0:
        return []

    document_vectors = np.asarray(document_embeddings, dtype=np.float32)
    theme_vectors = np.asarray(theme_embeddings, dtype=np.float32)
    if document_vectors.ndim != 2 or document_vectors.shape[0] != len(documents):
        raise ValueError("Document embeddings do not match the document batch.")
    if theme_vectors.ndim != 2 or theme_vectors.shape[0] != len(theme_names):
        raise ValueError("Theme embeddings do not match the theme names.")

    substantive_indices = [
        index
        for index, document in enumerate(documents)
        if not is_low_information_response(document)
    ]
    result: list[dict | None] = [None] * len(documents)
    for index, document in enumerate(documents):
        if is_low_information_response(document):
            result[index] = _low_information_metadata(config)

    if not substantive_indices:
        return [metadata for metadata in result if metadata is not None]

    similarities = document_vectors[substantive_indices] @ theme_vectors.T
    candidate_indices = np.argsort(-similarities, axis=1)[
        :, : config.candidate_count
    ]

    candidate_rows: list[list[dict]] = []
    reranker_pairs: list[tuple[str, str]] = []
    for local_index, document_index in enumerate(substantive_indices):
        candidates = []
        for embedding_rank, theme_index in enumerate(
            candidate_indices[local_index], start=1
        ):
            similarity = float(similarities[local_index, theme_index])
            theme_name = theme_names[int(theme_index)]
            candidates.append(
                {
                    "theme": theme_name,
                    "embedding_similarity": similarity,
                    "embedding_distance": float(1.0 - similarity),
                    "embedding_rank": embedding_rank,
                }
            )
            reranker_pairs.append(
                (theme_definition_text(theme_name), documents[document_index])
            )
        candidate_rows.append(candidates)

    if reranker_model is not None:
        raw_scores = np.asarray(
            reranker_model.predict(
                reranker_pairs,
                batch_size=RERANKER_BATCH_SIZE,
            ),
            dtype=np.float32,
        ).reshape(-1)
        expected_scores = len(substantive_indices) * config.candidate_count
        if raw_scores.size != expected_scores:
            raise ValueError(
                f"Reranker returned {raw_scores.size} scores for "
                f"{expected_scores} candidate pairs."
            )
    else:
        raw_scores = np.asarray(
            [
                candidate["embedding_similarity"]
                for candidates in candidate_rows
                for candidate in candidates
            ],
            dtype=np.float32,
        )

    score_offset = 0
    for document_index, candidates in zip(substantive_indices, candidate_rows):
        for candidate in candidates:
            candidate["score"] = float(raw_scores[score_offset])
            score_offset += 1
        candidates.sort(
            key=lambda candidate: (
                candidate["score"],
                candidate["embedding_similarity"],
            ),
            reverse=True,
        )
        margin = (
            float(candidates[0]["score"] - candidates[1]["score"])
            if len(candidates) > 1
            else float("inf")
        )
        ambiguous = (
            len(candidates) > 1
            and margin <= config.ambiguity_score_margin
        )
        metadata = {
            "theme_primary": candidates[0]["theme"],
            "theme_primary_score": candidates[0]["score"],
            "theme_primary_score_kind": config.score_kind,
            "theme_ambiguous": ambiguous,
            "theme_score_margin": margin if np.isfinite(margin) else 1.0,
            "theme_candidate_count": len(candidates),
            "theme_classification_method": config.method,
            "theme_embedding_model": config.embedding_model_id,
            "theme_reranker_model": config.reranker_model_id,
            "theme_classification_version": config.classification_version,
            "theme_taxonomy_version": config.taxonomy_version,
            "theme_ambiguity_score_margin": config.ambiguity_score_margin,
        }
        for candidate_position, candidate in enumerate(candidates, start=1):
            prefix = f"theme_candidate_{candidate_position}"
            metadata[prefix] = candidate["theme"]
            metadata[f"{prefix}_score"] = candidate["score"]
            metadata[f"{prefix}_embedding_similarity"] = candidate[
                "embedding_similarity"
            ]
            metadata[f"{prefix}_embedding_distance"] = candidate[
                "embedding_distance"
            ]
            metadata[f"{prefix}_embedding_rank"] = candidate["embedding_rank"]
        result[document_index] = metadata

    if any(metadata is None for metadata in result):
        raise RuntimeError("Theme classification did not produce one result per document.")
    return [metadata for metadata in result if metadata is not None]

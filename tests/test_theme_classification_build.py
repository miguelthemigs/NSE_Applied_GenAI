from __future__ import annotations

from importlib import import_module
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import chromadb
import numpy as np
import pandas as pd

from src.config.themes import THEME_EMBEDDING_DEFINITIONS
from src.pipeline.events import STAGES


theme_classifier = import_module("src.pipeline.02_embedding.theme_classifier")
vector_builder = import_module("src.pipeline.02_embedding.vector_builder")


class ScoreReranker:
    def __init__(self, scores) -> None:
        self.scores = np.asarray(scores, dtype=np.float32)
        self.calls = []
        self.kwargs = []

    def predict(self, pairs, **kwargs):
        self.calls.append(list(pairs))
        self.kwargs.append(kwargs)
        return self.scores


class ThemeScoreReranker:
    def __init__(self, scores_by_theme) -> None:
        self.scores_by_theme = scores_by_theme
        self.calls = []
        self.kwargs = []

    def predict(self, pairs, **kwargs):
        self.calls.append(list(pairs))
        self.kwargs.append(kwargs)
        scores = []
        for query, _document in pairs:
            theme = str(query).split(".", 1)[0]
            scores.append(self.scores_by_theme.get(theme, -10.0))
        return np.asarray(scores, dtype=np.float32)


class BuildEmbeddingModel:
    def __init__(self) -> None:
        self.document_batches = []

    def encode(self, values, **kwargs):
        values = list(values) if isinstance(values, list) else values
        if kwargs.get("prompt"):
            size = len(THEME_EMBEDDING_DEFINITIONS)
            embeddings = np.zeros((size, 2), dtype=np.float32)
            embeddings[:, 0] = np.linspace(1.0, 0.4, size)
            embeddings[:, 1] = np.linspace(0.0, 0.6, size)
            norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
            return embeddings / norms
        self.document_batches.append(list(values))
        return np.tile(
            np.asarray([[1.0, 0.0]], dtype=np.float32),
            (len(values), 1),
        )


class ThemeClassificationTests(unittest.TestCase):
    def test_reranker_can_change_embedding_first_choice(self) -> None:
        themes = ["Teachers", "Support / Mentoring", "Content and Organisation"]
        theme_embeddings = np.asarray(
            [
                [1.0, 0.0],
                [0.8, 0.2],
                [0.0, 1.0],
            ],
            dtype=np.float32,
        )
        config = theme_classifier.classification_config(
            "fake-embedding",
            reranker_model_id="fake-reranker",
            candidate_count=2,
            ambiguity_score_margin=0.1,
        )
        reranker = ScoreReranker([0.1, 0.9])

        result = theme_classifier.classify_theme_batch(
            ["My lecturer also helps me plan my study."],
            np.asarray([[1.0, 0.0]], dtype=np.float32),
            theme_names=themes,
            theme_embeddings=theme_embeddings,
            config=config,
            reranker_model=reranker,
        )[0]

        self.assertEqual(result["theme_primary"], "Support / Mentoring")
        self.assertEqual(result["theme_candidate_1_embedding_rank"], 2)
        self.assertEqual(result["theme_primary_score_kind"], "raw_cross_encoder_score")
        self.assertEqual(len(reranker.calls), 1)
        self.assertEqual(len(reranker.calls[0]), 2)
        self.assertEqual(
            reranker.kwargs[0]["batch_size"],
            theme_classifier.RERANKER_BATCH_SIZE,
        )

    def test_margin_rule_marks_close_reranker_scores_ambiguous(self) -> None:
        themes = ["Teachers", "Support / Mentoring"]
        config = theme_classifier.classification_config(
            "fake-embedding",
            reranker_model_id="fake-reranker",
            candidate_count=2,
            ambiguity_score_margin=0.2,
        )
        result = theme_classifier.classify_theme_batch(
            ["A genuinely multi-topic response."],
            np.asarray([[1.0, 0.0]], dtype=np.float32),
            theme_names=themes,
            theme_embeddings=np.asarray(
                [[1.0, 0.0], [0.9, 0.1]],
                dtype=np.float32,
            ),
            config=config,
            reranker_model=ScoreReranker([0.7, 0.6]),
        )[0]

        self.assertTrue(result["theme_ambiguous"])
        self.assertAlmostEqual(result["theme_score_margin"], 0.1, places=5)

    def test_fresh_build_and_interrupted_resume_keep_all_assignments(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            csv_path = root / "survey.csv"
            db_path = root / "vectors"
            checkpoint_path = root / "vector_checkpoint.json"
            cache_path = root / "gemma_cache.json"
            cache_path.write_text('{"stale": true}', encoding="utf-8")
            question = "What should improve?"
            pd.DataFrame(
                {
                    question: [
                        f"Teacher feedback response {index}"
                        for index in range(101)
                    ],
                    "location": ["A"] * 101,
                }
            ).to_csv(csv_path, index=False)

            first_model = BuildEmbeddingModel()
            with (
                mock.patch.object(
                    vector_builder,
                    "VECTOR_CHECKPOINT",
                    checkpoint_path,
                ),
                mock.patch.object(
                    import_module("src.pipeline.04_generation.cache"),
                    "CACHE_FILE",
                    cache_path,
                ),
                mock.patch.object(
                    vector_builder,
                    "load_embedding_model",
                    return_value=first_model,
                ),
                mock.patch.object(
                    vector_builder.reranker_models,
                    "reranker_enabled",
                    return_value=False,
                ),
                mock.patch.object(
                    vector_builder,
                    "unload_embedding_models",
                ),
                mock.patch.object(
                    vector_builder.reranker_models,
                    "unload_reranker_models",
                ),
            ):
                stream = vector_builder.build_vector_db_stream(
                    csv_path=str(csv_path),
                    db_path=str(db_path),
                    selected_columns=[question],
                    allow_model_download=False,
                )
                first_batch_event = None
                for line in stream:
                    event = json.loads(line)
                    if event.get("checkpoint_saved"):
                        first_batch_event = event
                        break
                stream.close()

            self.assertIsNotNone(first_batch_event)
            self.assertEqual(first_batch_event["progress"], 94)
            # An interrupted build must keep the existing summaries.
            self.assertTrue(cache_path.exists())
            interrupted_collection = chromadb.PersistentClient(
                path=str(db_path)
            ).get_collection("survey_responses")
            self.assertEqual(interrupted_collection.count(), 100)
            self.assertEqual(
                interrupted_collection.metadata[
                    "theme_classification_status"
                ],
                theme_classifier.CLASSIFICATION_STATUS_BUILDING,
            )
            self.assertTrue(checkpoint_path.exists())

            second_model = BuildEmbeddingModel()
            insight_cache = import_module("src.pipeline.04_generation.cache")
            insight_cache.set_overview_response("k", b"stale")
            with (
                mock.patch.object(
                    vector_builder,
                    "VECTOR_CHECKPOINT",
                    checkpoint_path,
                ),
                mock.patch.object(
                    import_module("src.pipeline.04_generation.cache"),
                    "CACHE_FILE",
                    cache_path,
                ),
                mock.patch.object(
                    vector_builder,
                    "load_embedding_model",
                    return_value=second_model,
                ),
                mock.patch.object(
                    vector_builder.reranker_models,
                    "reranker_enabled",
                    return_value=False,
                ),
                mock.patch.object(
                    vector_builder,
                    "unload_embedding_models",
                ),
                mock.patch.object(
                    vector_builder.reranker_models,
                    "unload_reranker_models",
                ),
            ):
                events = [
                    json.loads(line)
                    for line in vector_builder.build_vector_db_stream(
                        csv_path=str(csv_path),
                        db_path=str(db_path),
                        selected_columns=[question],
                        allow_model_download=False,
                    )
                ]

            self.assertEqual(events[-1]["status"], "success", events)
            # A successful build invalidates the stale summaries.
            self.assertFalse(cache_path.exists())
            self.assertIsNone(insight_cache.get_overview_response("k"))
            self.assertEqual(second_model.document_batches, [["Teacher feedback response 100"]])
            completed = chromadb.PersistentClient(
                path=str(db_path)
            ).get_collection("survey_responses")
            stored = completed.get(include=["metadatas"])
            self.assertEqual(completed.count(), 101)
            self.assertEqual(len(set(stored["ids"])), 101)
            self.assertTrue(
                all(
                    metadata.get("theme_primary")
                    for metadata in stored["metadatas"]
                )
            )
            self.assertEqual(
                completed.metadata["theme_classification_status"],
                theme_classifier.CLASSIFICATION_STATUS_READY,
            )
            self.assertFalse(checkpoint_path.exists())

    def test_stream_build_defers_reranker_until_explicit_rerank_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            csv_path = root / "survey.csv"
            db_path = root / "vectors"
            checkpoint_path = root / "vector_checkpoint.json"
            cache_path = root / "gemma_cache.json"
            question = "What should improve?"
            pd.DataFrame(
                {
                    question: [
                        "Teacher support and mentoring overlap.",
                        "Professional practice projects are useful.",
                    ],
                    "location": ["A", "A"],
                }
            ).to_csv(csv_path, index=False)

            model = BuildEmbeddingModel()
            load_reranker = mock.Mock(
                return_value=ThemeScoreReranker(
                    {
                        "Support / Mentoring": 8.0,
                        "Teachers": 1.0,
                        "No Meaningful Response": -5.0,
                    }
                )
            )
            with (
                mock.patch.object(vector_builder, "VECTOR_CHECKPOINT", checkpoint_path),
                mock.patch.object(
                    import_module("src.pipeline.04_generation.cache"),
                    "CACHE_FILE",
                    cache_path,
                ),
                mock.patch.object(
                    vector_builder,
                    "_classification_for_embedding_model",
                    return_value=theme_classifier.classification_config(
                        "Octen/Octen-Embedding-0.6B",
                        reranker_model_id=None,
                        ambiguity_score_margin=1.0,
                    ),
                ),
                mock.patch.object(
                    vector_builder,
                    "load_embedding_model",
                    return_value=model,
                ),
                mock.patch.object(
                    vector_builder.reranker_models,
                    "load_reranker_model",
                    load_reranker,
                ),
                mock.patch.object(vector_builder, "unload_embedding_models"),
                mock.patch.object(vector_builder.reranker_models, "unload_reranker_models"),
            ):
                events = [
                    json.loads(line)
                    for line in vector_builder.build_vector_db_stream(
                        csv_path=str(csv_path),
                        db_path=str(db_path),
                        selected_columns=[question],
                        allow_model_download=False,
                    )
                ]

                self.assertEqual(events[-1]["status"], "success", events)
                progress_events = [e for e in events if e["status"] == "progress"]
                self.assertTrue(progress_events)
                for event in progress_events:
                    self.assertIn(event.get("stage"), STAGES, event)
                load_reranker.assert_not_called()
                collection = chromadb.PersistentClient(
                    path=str(db_path)
                ).get_collection("survey_responses")
                self.assertEqual(
                    collection.metadata["theme_reranker_status"],
                    "not_run",
                )

                rerank_events = [
                    json.loads(line)
                    for line in vector_builder.apply_theme_reranker_stream(
                        db_path=str(db_path),
                        reranker_model_id="fake-reranker",
                        allow_model_download=False,
                    )
                ]

            self.assertEqual(rerank_events[-1]["status"], "success", rerank_events)
            for event in rerank_events:
                if event["status"] == "progress":
                    self.assertIn(event.get("stage"), STAGES, event)
            self.assertGreater(rerank_events[-1]["reranked_documents"], 0)
            self.assertGreater(rerank_events[-1]["changed_primary"], 0)
            completed = chromadb.PersistentClient(
                path=str(db_path)
            ).get_collection("survey_responses")
            self.assertEqual(
                completed.metadata["theme_reranker_model"],
                "fake-reranker",
            )
            # A reranked collection is still a ready vector DB.
            self.assertTrue(vector_builder.vector_db_is_ready(str(db_path)))
            updated = completed.get(include=["metadatas"])["metadatas"]
            self.assertTrue(
                any(
                    metadata.get("theme_primary_score_kind")
                    == "raw_cross_encoder_score"
                    and metadata.get("theme_embedding_primary")
                    and metadata.get("theme_ambiguous") is False
                    for metadata in updated
                )
            )

    def test_rerank_pass_keeps_unsure_answers_in_their_theme_shortlist(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            db_path = root / "vectors"
            config = theme_classifier.embedding_classification_config("fake-model")
            collection = chromadb.PersistentClient(path=str(db_path)).create_collection(
                "survey_responses",
                metadata={
                    "embedding_model": "fake-model",
                    **config.collection_metadata(
                        status=theme_classifier.CLASSIFICATION_STATUS_READY
                    ),
                },
            )
            shortlist = ["Teachers", "Support / Mentoring", "Content and Organisation"]
            metadata = {
                "theme_primary": "Teachers",
                "theme_ambiguous": True,
                "theme_candidate_count": len(shortlist),
            }
            for position, theme in enumerate(shortlist, start=1):
                prefix = f"theme_candidate_{position}"
                metadata[prefix] = theme
                metadata[f"{prefix}_embedding_similarity"] = 0.5 - position * 0.01
                metadata[f"{prefix}_embedding_distance"] = 0.5 + position * 0.01
                metadata[f"{prefix}_embedding_rank"] = position
            collection.add(
                ids=["doc_0"],
                documents=[
                    "Dit was echt onduidelijk en ik wist niet wat er van me verwacht werd."
                ],
                metadatas=[metadata],
                embeddings=[[1.0, 0.0]],
            )
            # A vague but real answer that would score highest against a
            # "no meaningful response" description if one were offered.
            reranker = ThemeScoreReranker(
                {
                    "No Meaningful Response": 50.0,
                    "Support / Mentoring": 2.0,
                    "Teachers": 1.0,
                    "Content and Organisation": 0.5,
                }
            )
            with (
                mock.patch.object(
                    vector_builder.reranker_models,
                    "load_reranker_model",
                    return_value=reranker,
                ),
                mock.patch.object(vector_builder.reranker_models, "unload_reranker_models"),
                mock.patch.object(
                    import_module("src.pipeline.04_generation.cache"),
                    "CACHE_FILE",
                    root / "gemma_cache.json",
                ),
            ):
                events = [
                    json.loads(line)
                    for line in vector_builder.apply_theme_reranker_stream(
                        db_path=str(db_path),
                        reranker_model_id="fake-reranker",
                        allow_model_download=False,
                    )
                ]

            self.assertEqual(events[-1]["status"], "success", events)
            self.assertEqual(events[-1]["low_information_reassigned"], 0)
            scored_themes = {
                str(query).split(".", 1)[0] for query, _document in reranker.calls[0]
            }
            self.assertEqual(scored_themes, set(shortlist))
            stored = (
                chromadb.PersistentClient(path=str(db_path))
                .get_collection("survey_responses")
                .get(include=["metadatas"])["metadatas"][0]
            )
            self.assertEqual(stored["theme_primary"], "Support / Mentoring")
            self.assertEqual(stored["theme_candidate_count"], len(shortlist))
            self.assertIs(stored["theme_ambiguous"], False)


if __name__ == "__main__":
    unittest.main()

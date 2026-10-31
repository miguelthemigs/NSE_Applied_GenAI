from __future__ import annotations

from importlib import import_module
import unittest
from unittest import mock

from flask import Flask

from src.config import model_tiers

embedding_models = import_module("src.pipeline.02_embedding.embedding_models")
llama_models = import_module("src.pipeline.04_generation.llama_cpp_models")
pipeline_routes = import_module("src.api.pipeline_routes")

DEFAULT_LLM = "unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL"


class TierRegistryTests(unittest.TestCase):
    def test_vector_models_are_available_embedding_models(self):
        for tier, ids in model_tiers.TIERS.items():
            self.assertIn(ids["vectors"], embedding_models.AVAILABLE_EMBEDDING_MODELS, tier)

    def test_insight_models_resolve_in_llama_registry(self):
        for tier, ids in model_tiers.TIERS.items():
            self.assertEqual(llama_models.resolve_llama_cpp_model(ids["insights"]).id, ids["insights"], tier)

    def test_balanced_is_the_current_default(self):
        self.assertEqual(model_tiers.DEFAULT_TIER, "balanced")
        self.assertEqual(
            (model_tiers.TIERS["balanced"]["vectors"], model_tiers.TIERS["balanced"]["insights"]),
            (embedding_models.DEFAULT_EMBEDDING_MODEL, DEFAULT_LLM),
        )

    def test_tier_for_model(self):
        self.assertEqual(model_tiers.tier_for_model("vectors", "Octen/Octen-Embedding-4B"), "thorough")
        self.assertEqual(model_tiers.tier_for_model("insights", DEFAULT_LLM), "balanced")
        self.assertEqual(model_tiers.tier_for_model("vectors", "Octen/Octen-Embedding-0.6B"), "balanced")
        self.assertEqual(model_tiers.tier_for_model("insights", "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL"), "quick")
        self.assertIsNone(model_tiers.tier_for_model("vectors", "Octen/Octen-Embedding-8B"))
        self.assertIsNone(model_tiers.tier_for_model("insights", "nope"))
        self.assertIsNone(model_tiers.tier_for_model("bogus", "x"))


class TierRouteTests(unittest.TestCase):
    def setUp(self):
        model_tiers._reset_size_cache()
        app = Flask(__name__)
        app.register_blueprint(pipeline_routes.pipeline_bp)
        self.client = app.test_client()

    def _get(self, cached="/some/path", size=None, offline=False):
        info = mock.Mock()
        info.siblings = [mock.Mock(rfilename="model.safetensors", size=1_200_000_000)]
        api = mock.Mock()
        if size is None:
            api.return_value.model_info.side_effect = OSError("no network")
        else:
            api.return_value.model_info.return_value = info
        env = {"HF_HUB_OFFLINE": "1"} if offline else {"HF_HUB_OFFLINE": ""}
        with (
            mock.patch("huggingface_hub.try_to_load_from_cache", return_value=cached),
            mock.patch("huggingface_hub.HfApi", api),
            mock.patch.dict("os.environ", env),
        ):
            return self.client.get("/api/model-tiers"), api

    def test_three_tiers_per_step_with_bool_cached(self):
        res, _ = self._get(cached="/some/path", size=1)
        body = res.get_json()
        self.assertEqual(res.status_code, 200)
        for step in ("vectors", "insights"):
            rows = [r for r in body["tiers"] if r["step"] == step]
            self.assertEqual([r["tier"] for r in rows], ["quick", "balanced", "thorough"])
            for r in rows:
                self.assertIs(r["cached"], True)
                self.assertEqual(r["model_id"], model_tiers.TIERS[r["tier"]][step])
        self.assertEqual(body["advanced"]["vectors"], list(embedding_models.AVAILABLE_EMBEDDING_MODELS))
        self.assertIn(DEFAULT_LLM, body["advanced"]["insights"])

    def test_not_cached_is_false(self):
        res, _ = self._get(cached=None)
        self.assertTrue(all(r["cached"] is False for r in res.get_json()["tiers"]))

    def test_sizes_gguf_from_registry_and_embeddings_from_hub(self):
        body, _ = self._get(size=1)
        rows = {(r["step"], r["tier"]): r for r in body.get_json()["tiers"]}
        self.assertEqual(rows[("insights", "balanced")]["size_bytes"], 6_200_000_000)
        self.assertEqual(rows[("insights", "thorough")]["size_bytes"], 16_900_000_000)
        self.assertEqual(rows[("vectors", "quick")]["size_bytes"], 1_200_000_000)

    def test_network_error_gives_null_size_and_route_still_ok(self):
        res, _ = self._get(size=None)
        self.assertEqual(res.status_code, 200)
        rows = {(r["step"], r["tier"]): r for r in res.get_json()["tiers"]}
        self.assertIsNone(rows[("vectors", "quick")]["size_bytes"])
        self.assertEqual(rows[("insights", "quick")]["size_bytes"], 2_620_000_000)

    def test_offline_does_not_call_the_hub(self):
        res, api = self._get(size=1, offline=True)
        api.assert_not_called()
        rows = {(r["step"], r["tier"]): r for r in res.get_json()["tiers"]}
        self.assertIsNone(rows[("vectors", "quick")]["size_bytes"])

    def test_cache_check_failure_means_not_cached(self):
        with (
            mock.patch("huggingface_hub.try_to_load_from_cache", side_effect=RuntimeError("x")),
            mock.patch("huggingface_hub.HfApi", side_effect=RuntimeError("x")),
        ):
            res = self.client.get("/api/model-tiers")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(all(r["cached"] is False for r in res.get_json()["tiers"]))

    def test_hub_sizes_are_memoised(self):
        _, api = self._get(size=1)
        self.assertEqual(api.return_value.model_info.call_count, 2)  # 0.6B and 4B, not per tier
        with (
            mock.patch("huggingface_hub.try_to_load_from_cache", return_value=None),
            mock.patch("huggingface_hub.HfApi", api),
        ):
            self.client.get("/api/model-tiers")
        self.assertEqual(api.return_value.model_info.call_count, 2)


if __name__ == "__main__":
    unittest.main()

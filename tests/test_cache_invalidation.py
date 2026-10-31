from __future__ import annotations

from importlib import import_module
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from flask import Flask

try:
    import isolation  # noqa: F401
except ImportError:  # run as tests.test_cache_invalidation
    from tests import isolation  # noqa: F401

vector_routes = import_module("src.api.vector_routes")
pipeline_status = import_module("src.pipeline.status")
vector_builder = import_module("src.pipeline.02_embedding.vector_builder")
cache = import_module("src.pipeline.04_generation.cache")


def failing_stream(**_):
    yield json.dumps({"status": "error", "error": "boom"}) + "\n"


class CacheInvalidationTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.cache_file = Path(tmp.name) / "gemma_cache.json"
        self.cache_file.write_text("{}", encoding="utf-8")
        patcher = mock.patch.object(cache, "CACHE_FILE", self.cache_file)
        patcher.start()
        self.addCleanup(patcher.stop)
        # Step 1 is done, so the build gets past the anonymize gate.
        gate = mock.patch.object(
            pipeline_status,
            "build_pipeline_status",
            return_value={"status": "success", "steps": {"anonymize": {"state": "done"}}},
        )
        gate.start()
        self.addCleanup(gate.stop)
        app = Flask(__name__)
        app.register_blueprint(vector_routes.vector_bp)
        self.client = app.test_client()

    def _post(self, url, target):
        with mock.patch.object(vector_routes.embedding, target, side_effect=failing_stream):
            res = self.client.post(url, json={})
            b"".join(res.response)

    def test_failed_build_keeps_insight_cache(self):
        self._post("/api/build-vectors", "build_vectors_stream")
        self.assertTrue(self.cache_file.exists())

    def test_failed_rerank_keeps_insight_cache(self):
        self._post("/api/rerank-theme-assignments", "rerank_theme_assignments_stream")
        self.assertTrue(self.cache_file.exists())

    def test_invalidate_deletes_file_and_resets_overview_response_cache(self):
        cache.set_overview_response("k", b"x")
        vector_builder._invalidate_insight_cache()
        self.assertIsNone(cache.get_overview_response("k"))
        self.assertFalse(self.cache_file.exists())


if __name__ == "__main__":
    unittest.main()

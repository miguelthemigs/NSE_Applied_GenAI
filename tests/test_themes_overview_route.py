from __future__ import annotations

import unittest
from unittest import mock

from src.api import insight_routes


class ThemesOverviewRouteTests(unittest.TestCase):
    def setUp(self):
        from app import create_app

        self.client = create_app().test_client()
        patcher = mock.patch.object(
            insight_routes.generation.cache_store,
            "get_overview_response",
            return_value=None,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_validation_failure_returns_not_ready_200(self):
        with mock.patch.object(
            insight_routes.generation,
            "themes_overview_payload",
            side_effect=insight_routes.retrieval.ClassificationNotReady("not ready"),
        ):
            res = self.client.get("/api/themes-overview")
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertEqual(body["status"], "not_ready")
        self.assertEqual(body["reason"], "vectors_not_ready")
        self.assertEqual(body["themes"], {})
        self.assertEqual(body["themes_expected"], 7)
        self.assertNotIn("error", body["themes"])

    def test_unexpected_failure_returns_500(self):
        with mock.patch.object(
            insight_routes.generation, "themes_overview_payload", side_effect=KeyError("x")
        ):
            res = self.client.get("/api/themes-overview")
        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.get_json()["status"], "error")


if __name__ == "__main__":
    unittest.main()

"""A step 4 run that loses the LLM, or writes nothing at all, ends with an error.

Per-theme failures are skipped so one bad theme doesn't stop the run, but a
dead llama-server (LocalModelConnectionError) ends it with
`error.llm_unavailable`, and a run that wrote no summary for any theme never
reports success, so the route never marks step 4 completed.
"""
from __future__ import annotations

from importlib import import_module
import json
import unittest
from unittest import mock

try:
    import isolation  # noqa: F401
except ImportError:  # run as tests.test_generation_failures
    from tests import isolation  # noqa: F401

from src.api import insight_routes
from src.pipeline import jobs, status

generation = import_module("src.pipeline.04_generation.service")
retrieval = import_module("src.pipeline.03_retrieval.service")

THEMES = [{"name": "Teachers"}, {"name": "Support / Mentoring"}]


class FakeClient:
    def ensure_model_available(self, *_args, **_kwargs):
        return None

    def unload(self, _model):
        return None


def _events(stream) -> list[dict]:
    return [json.loads(line) for line in stream]


class PrecomputeFailureTests(unittest.TestCase):
    def setUp(self):
        self.saved_main: dict = {}
        self.saved_sub: dict = {}
        for patcher in (
            mock.patch.object(generation, "get_llm_client", return_value=FakeClient()),
            mock.patch.object(retrieval, "get_collection", return_value=object()),
            mock.patch.object(generation, "load_cache", return_value={}),
            mock.patch.object(generation, "save_cache", side_effect=self.saved_main.update),
            mock.patch.object(generation, "load_subtheme_cache", return_value={}),
            mock.patch.object(generation, "save_subtheme_cache", side_effect=self.saved_sub.update),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def _insights(self, payload, **kwargs):
        with mock.patch.object(generation, "_generate_theme_payload", side_effect=payload):
            return _events(generation.precompute_insights_stream(
                themes=THEMES, provider="test", llm_model="fake-llm", **kwargs
            ))

    def test_lost_llm_server_ends_the_run_with_llm_unavailable(self):
        events = self._insights(generation.LocalModelConnectionError("Could not connect to llama.cpp"))
        self.assertEqual(events[-1]["status"], "error")
        self.assertEqual(events[-1]["code"], "error.llm_unavailable")
        self.assertFalse(any(e["status"] == "success" for e in events))
        # It stops at the first theme instead of skipping every theme.
        self.assertFalse(any("Support / Mentoring" in (e.get("message") or "") and "Skipped" in (e.get("message") or "") for e in events))

    def test_nothing_generated_for_any_theme_is_an_error(self):
        events = self._insights(RuntimeError("bad JSON"))
        self.assertEqual(events[-1]["status"], "error")
        self.assertFalse(any(e["status"] == "success" for e in events))
        self.assertEqual(self.saved_main, {})

    def test_one_failed_theme_still_succeeds(self):
        def payload(**kwargs):
            if kwargs["theme_name"] == "Teachers":
                raise RuntimeError("bad JSON")
            return {"theme": kwargs["theme_name"], "summary": "ok"}

        events = self._insights(payload)
        self.assertEqual(events[-1]["status"], "success")

    def test_lost_llm_server_in_subthemes_ends_with_llm_unavailable(self):
        main_entry = {"theme": "Teachers"}
        with (
            mock.patch.object(generation, "load_cache", return_value={"Teachers": main_entry}),
            mock.patch.object(generation, "cache_has_full_dashboard_payload", return_value=True),
            mock.patch.object(generation, "_subthemes_for_precompute", return_value=["Clear explanations", "Feedback"]),
            mock.patch.object(generation, "_manifest_for_subtheme", return_value={"evidence_ids": ["E1"]}),
            mock.patch.object(
                generation, "_generate_theme_payload",
                side_effect=generation.LocalModelConnectionError("Could not connect"),
            ),
        ):
            events = _events(generation.precompute_subthemes_stream(
                themes=[{"name": "Teachers"}], provider="test", llm_model="fake-llm"
            ))
        self.assertEqual(events[-1]["status"], "error")
        self.assertEqual(events[-1]["code"], "error.llm_unavailable")
        self.assertFalse(any(e["status"] == "success" for e in events))

    def test_nothing_generated_in_subthemes_is_an_error(self):
        with (
            mock.patch.object(generation, "load_cache", return_value={"Teachers": {"theme": "Teachers"}}),
            mock.patch.object(generation, "cache_has_full_dashboard_payload", return_value=True),
            mock.patch.object(generation, "_subthemes_for_precompute", return_value=["Clear explanations"]),
            mock.patch.object(generation, "_manifest_for_subtheme", return_value={"evidence_ids": ["E1"]}),
            mock.patch.object(generation, "_generate_theme_payload", side_effect=RuntimeError("bad JSON")),
        ):
            events = _events(generation.precompute_subthemes_stream(
                themes=[{"name": "Teachers"}], provider="test", llm_model="fake-llm"
            ))
        self.assertEqual(events[-1]["status"], "error")
        self.assertFalse(any(e["status"] == "success" for e in events))


class PrecomputeRouteCompletionTests(unittest.TestCase):
    def setUp(self):
        from app import create_app

        self.client = create_app().test_client()
        gate = mock.patch.object(
            status, "build_pipeline_status",
            return_value={"status": "success", "steps": {"anonymize": {"state": "done"}}},
        )
        gate.start()
        self.addCleanup(gate.stop)
        jobs.finish_job()
        self.addCleanup(jobs.finish_job)

    def test_failed_run_is_not_marked_completed(self):
        lost = iter([json.dumps({"status": "error", "code": "error.llm_unavailable", "message": "gone"}) + "\n"])
        with mock.patch.object(generation, "precompute_insights_stream", return_value=lost), \
                mock.patch.object(insight_routes.state, "mark_completed") as mark:
            self.client.post("/api/precompute-insights", json={}).get_data()
        mark.assert_not_called()

    def test_successful_run_is_marked_completed(self):
        ok = iter([json.dumps({"status": "success", "progress": 100}) + "\n"])
        with mock.patch.object(generation, "precompute_insights_stream", return_value=ok), \
                mock.patch.object(insight_routes.state, "mark_completed") as mark:
            self.client.post("/api/precompute-insights", json={}).get_data()
        mark.assert_called_once_with("insights")


if __name__ == "__main__":
    unittest.main()

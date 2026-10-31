from __future__ import annotations

from importlib import import_module
import unittest
from unittest import mock

from src.api import insight_routes
from src.config.themes import LOW_INFORMATION_THEME, THEMES_LIST
from src.pipeline import jobs, model_downloads, status

cache = import_module("src.pipeline.04_generation.cache")
generation = import_module("src.pipeline.04_generation.service")
llm_clients = import_module("src.pipeline.04_generation.llm_clients")

INSIGHT_THEMES = [t for t in THEMES_LIST if t != LOW_INFORMATION_THEME]
FIELDS = (
    "frequency", "vector_relevant_count", "summary", "positive_comments",
    "critical_comments", "student_suggestions", "subthemes", "subtheme_mentions", "quotes",
)


def _entry(theme: str) -> dict:
    return {field: [] for field in FIELDS} | {"theme": theme}


class InsightResultsTests(unittest.TestCase):
    def _caches(self, main: dict, sub: dict):
        for name, value in (("load_cache", main), ("load_subtheme_cache", sub)):
            patcher = mock.patch.object(status._cache, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _combos(self, n: int):
        patcher = mock.patch.object(
            insight_routes, "_build_filter_grid", return_value=[{"location": str(i)} for i in range(n)]
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(insight_routes.retrieval, "filter_valid_combos", side_effect=lambda g: g)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_no_filters_gives_main_done_sub_count_and_filtered_off(self):
        main = {t: _entry(t) for t in INSIGHT_THEMES}
        sub = {f"{INSIGHT_THEMES[0]}::subquery=S{i}": _entry(INSIGHT_THEMES[0]) for i in range(3)}
        self._caches(main, sub)
        with mock.patch.object(jobs, "active_job", return_value=None):
            result = insight_routes.insight_results([])
        self.assertEqual(result["rows"][0], {"kind": "main", "done": 7, "total": 7, "state": "done"})
        self.assertEqual(result["rows"][1], {"kind": "sub", "done": 3, "total": None, "state": "done"})
        self.assertEqual(result["rows"][2], {"kind": "filtered", "done": 0, "total": 0, "state": "off"})
        self.assertIsNone(result["estimate"])

    def test_filters_with_no_cached_keys_is_not_started_with_estimate(self):
        self._caches({}, {})
        self._combos(18)
        with mock.patch.object(jobs, "active_job", return_value=None):
            result = insight_routes.insight_results(["location"])
        filtered = result["rows"][2]
        self.assertEqual(filtered["state"], "not_started")
        self.assertEqual(filtered["total"], 126)
        self.assertEqual(result["estimate"], {"count": 126, "minutes": 189})
        self.assertEqual(result["rows"][0]["state"], "not_started")

    def test_estimate_rounds_half_up_for_odd_counts(self):
        self._caches({}, {})
        with mock.patch.object(jobs, "active_job", return_value=None):
            for combos, count, minutes in ((1, 7, 11), (127, 889, 1334)):
                self._combos(combos)
                est = insight_routes.insight_results(["location"])["estimate"]
                self.assertEqual(est, {"count": count, "minutes": minutes})
        self.assertEqual(insight_routes._estimate(3)["minutes"], 5)
        self.assertEqual(insight_routes._estimate(127)["minutes"], 191)

    def test_preview_returns_same_estimate(self):
        from app import create_app

        self._combos(18)
        res = create_app().test_client().post("/api/precompute-preview", json={"filter_dimensions": ["location"]})
        self.assertEqual(res.get_json()["estimate"], {"count": 126, "minutes": 189})
        res = create_app().test_client().post("/api/precompute-preview", json={})
        self.assertIsNone(res.get_json()["estimate"])

    def test_filtered_done_counts_only_requested_dimensions(self):
        theme = INSIGHT_THEMES[0]
        main = {
            f'{theme}::filters={{"location":"0"}}': _entry(theme),
            f'{theme}::filters={{"location":"0","programme":"P"}}': _entry(theme),
            f'{theme}::filters={{"academic_year":"2024"}}': _entry(theme),
        }
        self._caches(main, {})
        self._combos(1)
        with mock.patch.object(jobs, "active_job", return_value=None):
            row = insight_routes.insight_results(["location"])["rows"][2]
        self.assertEqual(row["done"], 1)
        self.assertLessEqual(row["done"], row["total"])

    def test_active_insights_job_and_partial_filtered(self):
        theme = INSIGHT_THEMES[0]
        self._caches({theme: _entry(theme), f'{theme}::filters={{"location":"0"}}': _entry(theme)}, {})
        self._combos(2)
        with mock.patch.object(jobs, "active_job", return_value={"step": "insights", "stage": "x", "progress": 1}):
            running = insight_routes.insight_results(["location"])
        self.assertEqual([r["state"] for r in running["rows"]], ["in_progress"] * 3)
        with mock.patch.object(jobs, "active_job", return_value=None):
            idle = insight_routes.insight_results(["location"])
        self.assertEqual(idle["rows"][0]["state"], "partial")
        self.assertEqual(idle["rows"][2]["state"], "partial")
        self.assertEqual(idle["rows"][2]["done"], 1)

    def test_route_parses_filter_dimensions_and_never_touches_llm(self):
        from app import create_app

        self._caches({}, {})
        with mock.patch.object(insight_routes, "insight_results", return_value={"rows": [], "estimate": None}) as fn, \
                mock.patch.object(generation, "get_llm_client", side_effect=AssertionError("LLM touched")):
            res = create_app().test_client().get("/api/insights/results?filter_dimensions=academic_year,location,programme")
            self.assertEqual(res.status_code, 200)
            fn.side_effect = RuntimeError("secret detail")
            bad = create_app().test_client().get("/api/insights/results")
            self.assertEqual(bad.status_code, 500)
            self.assertEqual(bad.get_json(), {"status": "error", "code": "error.backend"})
            fn.side_effect = None
            fn.reset_mock()
            create_app().test_client().get("/api/insights/results?filter_dimensions=academic_year,location,programme")
        fn.assert_called_once_with(["academic_year", "location", "programme"])


class RouteBehaviourTests(unittest.TestCase):
    def setUp(self):
        from app import create_app

        self.client = create_app().test_client()

    def test_precompute_without_themes_defaults_to_theme_list(self):
        with mock.patch.object(generation, "precompute_insights_stream", return_value=iter(["{}\n"])) as stream, \
                mock.patch.object(insight_routes.state, "mark_completed"):
            res = self.client.post("/api/precompute-insights", json={"precache_subthemes": True})
            res.get_data()
        self.assertEqual(res.status_code, 200)
        self.assertEqual([t["name"] for t in stream.call_args.kwargs["themes"]], THEMES_LIST)

    def test_precompute_reads_model_id_like_start_stream(self):
        with mock.patch.object(generation, "precompute_insights_stream", return_value=iter(["{}\n"])) as stream, \
                mock.patch.object(insight_routes.state, "mark_completed"):
            self.client.post("/api/precompute-insights", json={"model_id": "picked/tier", "max_documents": 240}).get_data()
        self.assertEqual(stream.call_args.kwargs["llm_model"], "picked/tier")
        self.assertEqual(stream.call_args.kwargs["max_documents"], 240)
        with mock.patch.object(generation, "precompute_insights_stream", return_value=iter(["{}\n"])) as stream, \
                mock.patch.object(insight_routes.state, "mark_completed"):
            self.client.post("/api/precompute-insights", json={"llm_model": "legacy/id"}).get_data()
        self.assertEqual(stream.call_args.kwargs["llm_model"], "legacy/id")

    def test_theme_summary_uses_running_server_model_else_default(self):
        with mock.patch.object(generation, "generate_theme_summary", return_value={"status": "ok"}) as gen, \
                mock.patch.object(llm_clients.LlamaCppClient, "running_managed_model_id", return_value="running/model"):
            self.client.post("/api/theme-summary", json={"theme": "Teachers"})
        self.assertEqual(gen.call_args.kwargs["llm_model"], "running/model")
        with mock.patch.object(generation, "generate_theme_summary", return_value={"status": "ok"}) as gen, \
                mock.patch.object(llm_clients.LlamaCppClient, "running_managed_model_id", return_value=None):
            self.client.post("/api/theme-summary", json={"theme": "Teachers"})
        self.assertEqual(gen.call_args.kwargs["llm_model"], insight_routes.settings.DEFAULT_LLM_MODEL)
        with mock.patch.object(generation, "generate_theme_summary", return_value={"status": "ok"}) as gen:
            self.client.post("/api/theme-summary", json={"theme": "Teachers", "llm_model": "explicit"})
        self.assertEqual(gen.call_args.kwargs["llm_model"], "explicit")

    def test_start_stream_unknown_model_is_backend_error_not_model_missing(self):
        res = self.client.post("/api/llm-models/start-stream", json={"model_id": "nope/not-a-model"})
        self.assertEqual(res.status_code, 400)
        body = res.get_json()
        self.assertEqual(body["code"], "error.backend")
        self.assertIn("nope/not-a-model", body["error"])


class RestartKeepsHealthyServerTests(unittest.TestCase):
    def test_uncached_model_does_not_stop_running_server(self):
        client = llm_clients.LlamaCppClient()
        with mock.patch.object(
            model_downloads, "require_local", side_effect=model_downloads.ModelNotDownloadedError("missing")
        ), mock.patch.object(llm_clients.LlamaCppClient, "_stop_managed_server") as stop:
            with self.assertRaises(model_downloads.ModelNotDownloadedError):
                client._restart_llama_server(insight_routes.settings.DEFAULT_LLM_MODEL)
        stop.assert_not_called()


if __name__ == "__main__":
    unittest.main()

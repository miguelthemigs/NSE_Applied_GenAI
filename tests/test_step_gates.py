"""Server-side gates in front of the pipeline routes.

- Steps 3, 4 and 5 refuse (409 error.blocked) unless step 1 is `done`, like
  step 2 does (D7): never rerank, summarise or search unreviewed answers.
- Only one pipeline job runs at a time: a second start answers 409
  error.busy before streaming and leaves the running job's slot alone.
- Starting the step 4 model (start-stream) is a tracked `insights` job.
"""
from __future__ import annotations

import contextlib
from importlib import import_module
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from flask import Flask

try:
    import isolation  # noqa: F401
except ImportError:  # run as tests.test_step_gates
    from tests import isolation  # noqa: F401

from src.api import register_blueprints
from src.pipeline import jobs, state
from src.pipeline import status as pipeline_status
from src.pipeline.events import stream_event

anonymization = import_module("src.pipeline.01_anonymization.service")
embedding = import_module("src.pipeline.02_embedding.service")
generation = import_module("src.pipeline.04_generation.service")
retrieval = import_module("src.pipeline.03_retrieval.service")


def _status(anonymize_state: str) -> dict:
    return {"status": "success", "steps": {"anonymize": {"state": anonymize_state}}}


class _RouteTestCase(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        register_blueprints(app)
        self.client = app.test_client()
        jobs.finish_job()
        self.addCleanup(jobs.finish_job)
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.enterContext(mock.patch.object(state, "PIPELINE_STATE_FILE", self.dir / "pipeline_state.json"))
        self.started = []  # inner streams that actually ran

    def _gen(self, name):
        def fake(*_args, **_kwargs):
            self.started.append((name, jobs.active_job()))
            yield stream_event("progress", stage="process", progress=50)
            yield stream_event("success", progress=100)

        return fake

    def _anonymize_state(self, value=None, *, side_effect=None):
        kwargs = {"side_effect": side_effect} if side_effect else {"return_value": _status(value)}
        return mock.patch.object(pipeline_status, "build_pipeline_status", **kwargs)


GATED = [
    ("POST", "/api/rerank-theme-assignments", {}),
    ("POST", "/api/precompute-insights", {}),
    ("POST", "/api/precompute-subthemes", {"themes": [{"name": "Teachers"}]}),
    ("GET", "/api/query-vectors?query=docent", None),
]


class AnonymizeGateTests(_RouteTestCase):
    """Steps 3, 4 and 5 need a reviewed step 1, on top of their vectors requirement."""

    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.object(embedding._builder, "apply_theme_reranker_stream", side_effect=self._gen("rerank")))
        self.enterContext(mock.patch.object(generation, "precompute_insights_stream", side_effect=self._gen("insights")))
        self.enterContext(mock.patch.object(generation, "precompute_subthemes_stream", side_effect=self._gen("subthemes")))
        self.query = self.enterContext(
            mock.patch.object(retrieval, "query_vectors_payload", return_value={"status": "success", "results": []})
        )
        self.enterContext(mock.patch.object(retrieval, "filter_options_payload", return_value={"options": {}}))

    def _call(self, method, url, body):
        res = self.client.get(url) if method == "GET" else self.client.post(url, json=body)
        return res, b"".join(res.response)

    def assertBlocked(self, res, payload, url):
        self.assertEqual(res.status_code, 409, url)
        body = json.loads(payload)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["code"], "error.blocked")
        self.assertEqual(body["params"], {"step": "anonymize"})
        self.assertEqual(self.started, [], url)
        self.query.assert_not_called()

    def test_blocked_while_step1_needs_review(self):
        # The user's real install: step 1 needs review, the existing DB is done.
        for method, url, body in GATED:
            with self.subTest(url=url), self._anonymize_state("needs_review"):
                self.assertBlocked(*self._call(method, url, body), url)

    def test_blocked_for_every_state_but_done(self):
        for value in ("unverified", "not_started", "in_progress", "interrupted", "error"):
            for method, url, body in GATED:
                with self.subTest(state=value, url=url), self._anonymize_state(value):
                    self.assertBlocked(*self._call(method, url, body), url)

    def test_fails_closed_when_status_cannot_be_built(self):
        for method, url, body in GATED:
            with self.subTest(url=url), self._anonymize_state(side_effect=RuntimeError("unreadable")):
                self.assertBlocked(*self._call(method, url, body), url)

    def test_allowed_when_step1_done(self):
        for method, url, body in GATED:
            with self.subTest(url=url), self._anonymize_state("done"):
                res, payload = self._call(method, url, body)
                self.assertEqual(res.status_code, 200, url)
                self.assertIn(b'"success"', payload)
        self.assertEqual([name for name, _job in self.started], ["rerank", "insights", "subthemes"])
        self.query.assert_called_once()


class BusyGuardTests(_RouteTestCase):
    """Every streaming start route refuses while another job runs."""

    def setUp(self):
        super().setUp()
        upload = self.dir / "upload.csv"
        upload.write_text("id;Open antwoord\n1;tekst\n", encoding="utf-8")
        anonymized = self.dir / "anonymized_survey.csv"
        anonymized.write_text("id;Open antwoord\n1;tekst\n", encoding="utf-8")
        report = self.dir / "report.json"
        report.write_text(json.dumps({"columns": ["Open antwoord"]}), encoding="utf-8")
        for patcher in (
            mock.patch.object(anonymization, "get_upload_path", return_value=str(upload)),
            mock.patch.object(anonymization, "SEP_FILE", self.dir / "sep.txt"),
            mock.patch.object(anonymization, "ANONYMIZED_CSV_PATH", anonymized),
            mock.patch.object(anonymization._engine, "REPORT_JSON", report),
            mock.patch.object(anonymization._engine, "process_file_with_layers", side_effect=self._gen("anonymize")),
            mock.patch.object(anonymization._engine, "run_check_stream", side_effect=self._gen("check")),
            mock.patch.object(embedding, "ANONYMIZED_CSV_PATH", anonymized),
            mock.patch.object(embedding._builder, "build_vector_db_stream", side_effect=self._gen("vectors")),
            mock.patch.object(embedding._builder, "apply_theme_reranker_stream", side_effect=self._gen("rerank")),
            mock.patch.object(generation, "precompute_insights_stream", side_effect=self._gen("insights")),
            mock.patch.object(generation, "precompute_subthemes_stream", side_effect=self._gen("subthemes")),
            mock.patch.object(generation, "start_llm_stream", side_effect=self._gen("start")),
            mock.patch.object(retrieval, "filter_options_payload", return_value={"options": {}}),
            mock.patch.object(state, "mark_completed"),
            mock.patch.object(state, "reset_acknowledgement"),
            self._anonymize_state("done"),
        ):
            self.enterContext(patcher)

    STARTS = [
        ("/api/anonymize", {"selected_columns": ["Open antwoord"], "selected_layers": ["presidio"]}),
        ("/api/run-anonymize-check", None),
        ("/api/build-vectors", {}),
        ("/api/rerank-theme-assignments", {}),
        ("/api/precompute-insights", {}),
        ("/api/precompute-subthemes", {"themes": [{"name": "Teachers"}]}),
        ("/api/llm-models/start-stream", {}),
    ]

    def test_second_start_answers_409_busy_and_keeps_the_running_slot(self):
        jobs.start_job("vectors")
        jobs.update_job("process", 42)
        for url, body in self.STARTS:
            with self.subTest(url=url):
                res = self.client.post(url, json=body) if body is not None else self.client.post(url)
                payload = json.loads(b"".join(res.response))
                self.assertEqual(res.status_code, 409)
                self.assertEqual(payload["status"], "error")
                self.assertEqual(payload["code"], "error.busy")
                self.assertEqual(payload["params"], {"step": "vectors"})
                self.assertEqual(jobs.active_job(), {"step": "vectors", "stage": "process", "progress": 42})
        self.assertEqual(self.started, [])

    def test_each_start_runs_when_the_slot_is_free_and_releases_it(self):
        for url, body in self.STARTS:
            with self.subTest(url=url):
                res = self.client.post(url, json=body) if body is not None else self.client.post(url)
                b"".join(res.response)
                self.assertEqual(res.status_code, 200)
                self.assertIsNone(jobs.active_job())
        self.assertEqual(
            [name for name, _job in self.started],
            ["anonymize", "check", "vectors", "rerank", "insights", "subthemes", "start"],
        )

    def test_model_start_is_a_tracked_insights_job_without_completion(self):
        res = self.client.post("/api/llm-models/start-stream", json={})
        events = [json.loads(line) for line in b"".join(res.response).splitlines() if line.strip()]
        self.assertEqual(events[-1]["status"], "success")
        (name, job), = self.started
        self.assertEqual(job["step"], "insights")
        self.assertIsNone(jobs.active_job())
        state.mark_completed.assert_not_called()

    def test_precompute_right_after_model_start_is_not_busy(self):
        b"".join(self.client.post("/api/llm-models/start-stream", json={}).response)
        res = self.client.post("/api/precompute-insights", json={})
        b"".join(res.response)
        self.assertEqual(res.status_code, 200)


if __name__ == "__main__":
    unittest.main()

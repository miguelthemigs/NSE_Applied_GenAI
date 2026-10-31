from __future__ import annotations

import contextlib
from datetime import datetime, timezone
from importlib import import_module
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from flask import Flask

from src.config.themes import LOW_INFORMATION_THEME, THEMES_LIST
from src.pipeline import jobs, state, status
from src.pipeline.events import stream_event

pipeline_routes = import_module("src.api.pipeline_routes")
cache = import_module("src.pipeline.04_generation.cache")

INSIGHT_THEMES = [theme for theme in THEMES_LIST if theme != LOW_INFORMATION_THEME]
READY_METADATA = {
    "embedding_model": "Octen/Octen-Embedding-0.6B",
    "theme_classification_status": "ready",
    "theme_reranker_status": "not_run",
}
FULL_PAYLOAD_FIELDS = (
    "frequency",
    "vector_relevant_count",
    "summary",
    "positive_comments",
    "critical_comments",
    "student_suggestions",
    "subthemes",
    "subtheme_mentions",
    "quotes",
)


def _full_entry(theme: str) -> dict:
    return {field: [] for field in FULL_PAYLOAD_FIELDS} | {"theme": theme}


class PipelineStatusTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.csv = self.dir / "anonymized_survey.csv"
        self.report = self.dir / "anonymization_report.json"
        self.anon_checkpoint = self.dir / "anon_checkpoint_meta.json"
        self.vector_checkpoint = self.dir / "vector_checkpoint.json"
        self.state_file = self.dir / "pipeline_state.json"
        self.cache_file = self.dir / "gemma_cache.json"
        self.subtheme_cache_file = self.dir / "gemma_subtheme_cache.json"
        self.vector_ready = False
        self.vector_metadata: dict = {}
        self.vector_count = None

        patches = [
            mock.patch.object(status, "ANONYMIZED_CSV_PATH", self.csv),
            mock.patch.object(status, "ANON_REPORT_JSON", self.report),
            mock.patch.object(status, "ANON_CHECKPOINT_META", self.anon_checkpoint),
            mock.patch.object(status, "VECTOR_CHECKPOINT", self.vector_checkpoint),
            mock.patch.object(status, "VECTOR_DB_PATH", self.dir / "survey_vector_db"),
            mock.patch.object(state, "PIPELINE_STATE_FILE", self.state_file),
            mock.patch.object(cache, "CACHE_FILE", self.cache_file),
            mock.patch.object(cache, "SUBTHEME_CACHE_FILE", self.subtheme_cache_file),
            mock.patch.object(
                status, "vector_db_is_ready", side_effect=lambda: self.vector_ready
            ),
            mock.patch.object(
                status,
                "read_vector_collection",
                side_effect=lambda: (dict(self.vector_metadata), self.vector_count),
            ),
            mock.patch.object(
                cache, "cache_matches_generation_settings", return_value=True
            ),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        jobs.finish_job()
        self.addCleanup(jobs.finish_job)

        app = Flask(__name__)
        app.register_blueprint(pipeline_routes.pipeline_bp)
        self.client = app.test_client()

    # -- fixtures ---------------------------------------------------------

    def _write_anonymize(
        self,
        *,
        review: int = 0,
        verified: bool = True,
        timestamp: str = "2026-10-31 10:00:00",
    ) -> None:
        self.csv.write_text("id,text\n1,[NAME] zei hallo\n", encoding="utf-8")
        missed = {"NAME": review, "PII": 0, "LOCATION": 0, "TITLE": 0, "HEALTH": 0}
        self.report.write_text(
            json.dumps(
                {
                    "rows_processed": 300,
                    "total_entities": 409,
                    "tag_counts": {
                        "NAME": 280,
                        "TITLE": 8,
                        "LOCATION": 16,
                        "PII": 73,
                        "HEALTH": 32,
                    },
                    "missed_counts": missed,
                    "missed_samples": {"NAME": ["Jan"] if review else []},
                    "verification_skipped": not verified,
                    "timestamp": timestamp,
                }
            ),
            encoding="utf-8",
        )

    def _vectors_ready(self, **metadata) -> None:
        self.vector_ready = True
        self.vector_metadata = {**READY_METADATA, **metadata}
        self.vector_count = 900

    def _write_state(self, payload: dict) -> None:
        self.state_file.write_text(json.dumps(payload), encoding="utf-8")

    def _status(self) -> dict:
        return status.build_pipeline_status()

    def _acknowledge(self, report_id: str | None = None):
        if report_id is None:
            report_id = self._status()["steps"]["anonymize"]["summary"]["report_id"]
        return self.client.post(
            "/api/pipeline/acknowledge-review", json={"report_id": report_id}
        )

    def _states(self) -> dict:
        return {name: step["state"] for name, step in self._status()["steps"].items()}

    # -- derivation table -------------------------------------------------

    def test_fresh_install(self):
        payload = self._status()
        self.assertEqual(payload["status"], "success")
        self.assertIsNone(payload["active_job"])
        self.assertIsNone(payload["last_updated"])
        states = self._states()
        self.assertEqual(states["anonymize"], "not_started")
        self.assertEqual(states["vectors"], "blocked")
        self.assertEqual(states["rerank"], "blocked")
        self.assertEqual(states["insights"], "blocked")
        self.assertEqual(states["query"], "blocked")

    def test_anon_needs_review(self):
        self._write_anonymize(review=1, verified=True)
        payload = self._status()
        anonymize = payload["steps"]["anonymize"]
        self.assertEqual(anonymize["state"], "needs_review")
        self.assertEqual(anonymize["summary"]["review"], 1)
        self.assertFalse(anonymize["summary"]["acknowledged"])
        self.assertEqual(payload["steps"]["vectors"]["state"], "blocked")

        self.assertEqual(anonymize["summary"]["report_id"], "2026-10-31 10:00:00")
        res = self._acknowledge()
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertEqual(body["steps"]["anonymize"]["state"], "done")
        self.assertTrue(body["steps"]["anonymize"]["summary"]["acknowledged"])
        self.assertEqual(body["steps"]["vectors"]["state"], "not_started")
        self.assertEqual(self._states()["anonymize"], "done")

    def test_anon_review_zero_is_done(self):
        self._write_anonymize(review=0, verified=True)
        payload = self._status()
        anonymize = payload["steps"]["anonymize"]
        self.assertEqual(anonymize["state"], "done")
        self.assertFalse(anonymize["summary"]["acknowledged"])
        self.assertEqual(payload["steps"]["vectors"]["state"], "not_started")

    def test_anon_unverified(self):
        self._write_anonymize(review=0, verified=False)
        payload = self._status()
        self.assertEqual(payload["steps"]["anonymize"]["state"], "unverified")
        self.assertFalse(payload["steps"]["anonymize"]["summary"]["verified"])
        self.assertEqual(payload["steps"]["vectors"]["state"], "blocked")

    def test_anon_unverified_stays_unverified_after_acknowledge(self):
        self._write_anonymize(review=0, verified=False)
        self.assertEqual(self._acknowledge().status_code, 200)
        self.assertEqual(self._states()["anonymize"], "unverified")

    def test_anon_interrupted(self):
        self._write_anonymize(review=0, verified=True)
        self.anon_checkpoint.write_text("{}", encoding="utf-8")
        self.assertEqual(self._states()["anonymize"], "interrupted")

    def test_anon_summary_by_type(self):
        self._write_anonymize(review=2, verified=True)
        summary = self._status()["steps"]["anonymize"]["summary"]
        self.assertEqual(summary["rows"], 300)
        self.assertEqual(summary["removed"], 409)
        self.assertTrue(summary["verified"])
        self.assertEqual(
            summary["by_type"],
            {"names": 288, "locations": 16, "numbers": 73, "health": 32},
        )

    def test_vectors_building_after_restart_is_interrupted(self):
        self._write_anonymize()
        self.vector_ready = False
        self.vector_metadata = {**READY_METADATA, "theme_classification_status": "building"}
        self.assertIsNone(jobs.active_job())
        states = self._states()
        self.assertEqual(states["vectors"], "interrupted")
        self.assertEqual(states["query"], "blocked")

    def test_vectors_checkpoint_is_interrupted_with_progress(self):
        self._write_anonymize()
        self.vector_checkpoint.write_text(
            json.dumps({"processed_count": 400, "total_docs": 900}), encoding="utf-8"
        )
        vectors = self._status()["steps"]["vectors"]
        self.assertEqual(vectors["state"], "interrupted")
        self.assertEqual(vectors["checkpoint"], {"processed": 400, "total": 900})

    def test_vectors_unreadable_checkpoint_is_still_interrupted(self):
        self._write_anonymize()
        self._vectors_ready()
        self.vector_checkpoint.write_text("{broken", encoding="utf-8")
        vectors = self._status()["steps"]["vectors"]
        self.assertEqual(vectors["state"], "interrupted")
        self.assertIsNone(vectors["checkpoint"])

    def test_rerun_step1_marks_downstream_stale(self):
        self._write_anonymize()
        self._vectors_ready(theme_reranker_status="ready")
        self.cache_file.write_text(
            json.dumps({theme: _full_entry(theme) for theme in INSIGHT_THEMES}),
            encoding="utf-8",
        )
        self._write_state(
            {
                "anonymize": {"completed_at": "2026-01-01T00:00:00.000000Z"},
                "vectors": {"completed_at": "2026-01-02T00:00:00.000000Z"},
                "rerank": {"completed_at": "2026-01-03T00:00:00.000000Z"},
                "insights": {"completed_at": "2026-01-04T00:00:00.000000Z"},
            }
        )
        states = self._states()
        self.assertEqual(states["vectors"], "done")
        self.assertEqual(states["rerank"], "done")
        self.assertEqual(states["insights"], "done")

        state.mark_completed("anonymize")

        states = self._states()
        self.assertEqual(states["anonymize"], "done")
        self.assertEqual(states["vectors"], "stale")
        self.assertEqual(states["rerank"], "stale")
        self.assertEqual(states["insights"], "stale")
        self.assertEqual(states["query"], "ready")

    def test_vectors_rebuilt_after_rerank_marks_rerank_stale(self):
        self._write_anonymize()
        self._vectors_ready(theme_reranker_status="ready")
        self._write_state(
            {
                "anonymize": {"completed_at": "2026-01-01T00:00:00.000000Z"},
                "vectors": {"completed_at": "2026-01-05T00:00:00.000000Z"},
                "rerank": {"completed_at": "2026-01-03T00:00:00.000000Z"},
            }
        )
        self.assertEqual(self._states()["rerank"], "stale")

    def test_insights_partial(self):
        self._write_anonymize()
        self._vectors_ready()
        self.cache_file.write_text(
            json.dumps({theme: _full_entry(theme) for theme in INSIGHT_THEMES[:3]}),
            encoding="utf-8",
        )
        insights = self._status()["steps"]["insights"]
        self.assertEqual(insights["state"], "partial")
        self.assertEqual(insights["summary"]["themes_done"], 3)
        self.assertEqual(insights["summary"]["themes_total"], 7)

    def test_insights_counts_subthemes_and_filtered(self):
        self._write_anonymize()
        self._vectors_ready()
        theme = INSIGHT_THEMES[0]
        self.cache_file.write_text(
            json.dumps(
                {
                    theme: _full_entry(theme),
                    f'{theme}::filters={{"location":"A"}}': _full_entry(theme),
                    INSIGHT_THEMES[1]: {"summary": "incomplete"},
                }
            ),
            encoding="utf-8",
        )
        self.subtheme_cache_file.write_text(
            json.dumps(
                {
                    f"{theme}::subquery=Feedback": _full_entry(theme),
                    f'{theme}::subquery=Feedback::filters={{"location":"A"}}': _full_entry(theme),
                }
            ),
            encoding="utf-8",
        )
        summary = self._status()["steps"]["insights"]["summary"]
        self.assertEqual(summary["themes_done"], 1)
        self.assertEqual(summary["subthemes_done"], 1)
        self.assertEqual(summary["filtered_done"], 1)

    def test_insights_stale_when_cache_settings_differ(self):
        self._write_anonymize()
        self._vectors_ready()
        self.cache_file.write_text(
            json.dumps({theme: _full_entry(theme) for theme in INSIGHT_THEMES}),
            encoding="utf-8",
        )
        with mock.patch.object(
            cache, "cache_matches_generation_settings", return_value=False
        ):
            self.assertEqual(self._states()["insights"], "stale")

    def test_rerank_skipped(self):
        self._write_anonymize()
        self._vectors_ready()
        res = self.client.post("/api/pipeline/skip-rerank", json={"skipped": True})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["steps"]["rerank"]["state"], "skipped")
        states = self._states()
        self.assertEqual(states["rerank"], "skipped")
        self.assertEqual(states["insights"], "not_started")

        res = self.client.post("/api/pipeline/skip-rerank", json={"skipped": False})
        self.assertEqual(res.get_json()["steps"]["rerank"]["state"], "not_started")

    def test_skip_rerank_rejects_non_boolean(self):
        res = self.client.post("/api/pipeline/skip-rerank", json={"skipped": "yes"})
        self.assertEqual(res.status_code, 400)

    def test_rerank_done_reports_stats(self):
        self._write_anonymize()
        self._vectors_ready(theme_reranker_status="ready")
        state.mark_completed(
            "rerank", stats={"ambiguous": 57, "changed": 12, "low_information": 3}
        )
        rerank = self._status()["steps"]["rerank"]
        self.assertEqual(rerank["state"], "done")
        self.assertEqual(
            rerank["summary"], {"ambiguous": 57, "changed": 12, "low_information": 3}
        )

    def test_active_job_reported(self):
        self._write_anonymize()
        jobs.start_job("vectors")
        jobs.update_job("process", 42)
        payload = self._status()
        self.assertEqual(
            payload["active_job"], {"step": "vectors", "stage": "process", "progress": 42}
        )
        self.assertEqual(payload["steps"]["vectors"]["state"], "in_progress")
        jobs.finish_job()
        self.assertIsNone(self._status()["active_job"])

    def test_last_updated_is_max_completed_at(self):
        self._write_anonymize()
        self._vectors_ready()
        self._write_state(
            {
                "anonymize": {"completed_at": "2026-10-01T10:00:00.000000Z"},
                "vectors": {"completed_at": "2026-10-02T09:30:00.000000Z"},
            }
        )
        payload = self._status()
        self.assertEqual(payload["last_updated"], "2026-10-02T09:30:00.000000Z")
        self.assertEqual(
            payload["steps"]["anonymize"]["completed_at"], "2026-10-01T10:00:00.000000Z"
        )

    # -- D7: acknowledgement is bound to one report ---------------------------

    def test_stale_report_id_is_rejected_and_state_unchanged(self):
        self._write_anonymize(review=1)
        before = self.state_file.read_bytes() if self.state_file.exists() else None
        res = self._acknowledge("2026-01-01 00:00:00")
        self.assertEqual(res.status_code, 409)
        body = res.get_json()
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["code"], "error.stale_review")
        self.assertEqual(body["steps"]["anonymize"]["state"], "needs_review")
        after = self.state_file.read_bytes() if self.state_file.exists() else None
        self.assertEqual(before, after)
        self.assertEqual(self._states()["anonymize"], "needs_review")

    def test_missing_report_id_is_rejected(self):
        self._write_anonymize(review=1)
        res = self.client.post("/api/pipeline/acknowledge-review", json={})
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.get_json()["code"], "error.stale_review")
        self.assertEqual(self._states()["anonymize"], "needs_review")

    def test_acknowledgement_of_old_report_does_not_cover_new_report(self):
        self._write_anonymize(review=1, timestamp="2026-10-31 10:00:00")
        self.assertEqual(self._acknowledge().status_code, 200)
        self.assertEqual(self._states()["anonymize"], "done")
        # A new report appears without any state write (e.g. hooks failed).
        self._write_anonymize(review=5, timestamp="2026-10-31 11:00:00")
        summary = self._status()["steps"]["anonymize"]["summary"]
        self.assertEqual(self._states()["anonymize"], "needs_review")
        self.assertFalse(summary["acknowledged"])

    def test_report_without_timestamp_uses_mtime_identity(self):
        self._write_anonymize(review=1)
        report = json.loads(self.report.read_text(encoding="utf-8"))
        del report["timestamp"]
        self.report.write_text(json.dumps(report), encoding="utf-8")
        report_id = self._status()["steps"]["anonymize"]["summary"]["report_id"]
        self.assertEqual(report_id, f"mtime_ns:{self.report.stat().st_mtime_ns}")
        self.assertEqual(self._acknowledge(report_id).status_code, 200)
        self.assertEqual(self._states()["anonymize"], "done")

    def test_anonymize_rerun_with_failing_state_writes_still_needs_review(self):
        anonymization = import_module("src.pipeline.01_anonymization.service")
        self._write_anonymize(review=1, timestamp="2026-10-31 10:00:00")
        self.assertEqual(self._acknowledge().status_code, 200)
        upload = self.dir / "upload.csv"
        upload.write_text("id\n1\n", encoding="utf-8")

        def fake_process(*_args, **_kwargs):
            self._write_anonymize(review=5, timestamp="2026-10-31 11:00:00")
            yield stream_event("success", progress=100)

        with (
            contextlib.redirect_stdout(io.StringIO()),
            mock.patch.object(anonymization, "get_upload_path", return_value=str(upload)),
            mock.patch.object(anonymization, "SEP_FILE", self.dir / "sep.txt"),
            mock.patch.object(
                anonymization._engine, "process_file_with_layers", side_effect=fake_process
            ),
            mock.patch.object(state, "_write_state", side_effect=OSError("disk full")),
        ):
            list(anonymization.anonymize_uploaded_file(["id"], ["presidio"]))
        anonymize = self._status()["steps"]["anonymize"]
        self.assertEqual(anonymize["state"], "needs_review")
        self.assertEqual(anonymize["summary"]["review"], 5)
        self.assertFalse(anonymize["summary"]["acknowledged"])

    def test_recheck_resets_acknowledgement_on_start_and_success(self):
        anonymization = import_module("src.pipeline.01_anonymization.service")
        self._write_anonymize(review=1)
        self.assertEqual(self._acknowledge().status_code, 200)
        upload = self.dir / "upload.csv"
        upload.write_text("id\n1\n", encoding="utf-8")
        during = []

        def fake_check(*_args, **_kwargs):
            # The report is left untouched, so only the reset can flip the state.
            during.append(state.load_state()["anonymize"]["acknowledged"])
            yield stream_event("success", progress=100)

        with (
            mock.patch.object(anonymization, "get_upload_path", return_value=str(upload)),
            mock.patch.object(anonymization, "ANONYMIZED_CSV_PATH", self.csv),
            mock.patch.object(anonymization._engine, "REPORT_JSON", self.report),
            mock.patch.object(
                anonymization._engine, "run_check_stream", side_effect=fake_check
            ),
        ):
            list(anonymization.run_anonymize_check_stream())
        self.assertEqual(during, [False])
        entry = state.load_state()["anonymize"]
        self.assertFalse(entry["acknowledged"])
        self.assertIsNone(entry["acknowledged_report"])
        self.assertEqual(self._states()["anonymize"], "needs_review")

    # -- robustness -------------------------------------------------------

    def test_malformed_report_errors_only_that_step(self):
        self._write_anonymize(review=1)
        report = json.loads(self.report.read_text(encoding="utf-8"))
        report["missed_counts"] = [1, 2]
        self.report.write_text(json.dumps(report), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            res = self.client.get("/api/pipeline/status")
        self.assertEqual(res.status_code, 200)
        steps = res.get_json()["steps"]
        self.assertEqual(steps["anonymize"]["state"], "error")
        self.assertIsNone(steps["anonymize"]["summary"])
        self.assertEqual(steps["vectors"]["state"], "blocked")

    def test_completed_at_falls_back_to_artefact_mtime(self):
        self._write_anonymize()
        completed_at = self._status()["steps"]["anonymize"]["completed_at"]
        expected = datetime.fromtimestamp(
            self.csv.stat().st_mtime, tz=timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        self.assertEqual(completed_at, expected)

    def test_status_route_returns_contract(self):
        res = self.client.get("/api/pipeline/status")
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertEqual(
            set(body), {"status", "last_updated", "active_job", "steps"}
        )
        self.assertEqual(
            set(body["steps"]), {"anonymize", "vectors", "rerank", "insights", "query"}
        )
        self.assertEqual(set(body["steps"]["query"]), {"state"})


class StreamWiringTests(unittest.TestCase):
    """The service streams record the job and, on success only, the state."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.state_file = self.dir / "pipeline_state.json"
        self.csv = self.dir / "anonymized_survey.csv"
        self.csv.write_text("id\n1\n", encoding="utf-8")
        self.embedding = import_module("src.pipeline.02_embedding.service")
        self.anonymization = import_module("src.pipeline.01_anonymization.service")
        for patcher in (
            mock.patch.object(state, "PIPELINE_STATE_FILE", self.state_file),
            mock.patch.object(self.embedding, "ANONYMIZED_CSV_PATH", self.csv),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        jobs.finish_job()
        self.addCleanup(jobs.finish_job)
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))

    def test_vector_build_success_records_model_and_documents(self):
        def fake_build(**_):
            self.assertEqual(jobs.active_job()["step"], "vectors")
            yield stream_event("progress", stage="process", progress=50)
            yield stream_event("success", progress=100, document_count=900)

        with mock.patch.object(
            self.embedding._builder, "build_vector_db_stream", side_effect=fake_build
        ):
            list(
                self.embedding.build_vectors_stream(
                    embedding_model="Octen/Octen-Embedding-0.6B",
                    selected_columns=None,
                    allow_model_download=False,
                )
            )
        entry = state.load_state()["vectors"]
        self.assertEqual(entry["model"], "Octen/Octen-Embedding-0.6B")
        self.assertEqual(entry["documents"], 900)
        self.assertEqual(entry["tier"], "balanced")
        self.assertIn("completed_at", entry)
        self.assertIsNone(jobs.active_job())

    def test_rerank_success_saves_stats_and_clears_skip(self):
        state.set_flag("rerank", "skipped", True)

        def fake_rerank(**_):
            yield stream_event(
                "success",
                progress=100,
                reranked_documents=57,
                changed_primary=12,
                low_information_reassigned=3,
            )

        with mock.patch.object(
            self.embedding._builder,
            "apply_theme_reranker_stream",
            side_effect=fake_rerank,
        ):
            list(
                self.embedding.rerank_theme_assignments_stream(
                    reranker_model=None, allow_model_download=False
                )
            )
        entry = state.load_state()["rerank"]
        self.assertEqual(
            entry["stats"], {"ambiguous": 57, "changed": 12, "low_information": 3}
        )
        self.assertFalse(entry["skipped"])

    def test_failed_rerank_writes_no_state(self):
        def fake_rerank(**_):
            yield stream_event("error", code="error.backend")

        with mock.patch.object(
            self.embedding._builder,
            "apply_theme_reranker_stream",
            side_effect=fake_rerank,
        ):
            list(
                self.embedding.rerank_theme_assignments_stream(
                    reranker_model=None, allow_model_download=False
                )
            )
        self.assertFalse(self.state_file.exists())

    def test_anonymize_success_resets_acknowledgement(self):
        state.set_flag("anonymize", "acknowledged", True)
        upload = self.dir / "upload.csv"
        upload.write_text("id\n1\n", encoding="utf-8")

        def fake_process(*_args, **_kwargs):
            self.assertEqual(jobs.active_job()["step"], "anonymize")
            yield stream_event("success", progress=100)

        with (
            mock.patch.object(
                self.anonymization, "get_upload_path", return_value=str(upload)
            ),
            mock.patch.object(self.anonymization, "SEP_FILE", self.dir / "sep.txt"),
            mock.patch.object(
                self.anonymization._engine,
                "process_file_with_layers",
                side_effect=fake_process,
            ),
        ):
            list(self.anonymization.anonymize_uploaded_file(["id"], ["presidio"]))
        entry = state.load_state()["anonymize"]
        self.assertFalse(entry["acknowledged"])
        self.assertIn("completed_at", entry)


class PipelineStateFileTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "nested" / "pipeline_state.json"

    def test_mark_completed_anonymize_resets_acknowledged(self):
        state.set_flag("anonymize", "acknowledged", True, path=self.path)
        self.assertTrue(state.load_state(self.path)["anonymize"]["acknowledged"])
        state.mark_completed("anonymize", path=self.path)
        entry = state.load_state(self.path)["anonymize"]
        self.assertFalse(entry["acknowledged"])
        self.assertIsNone(entry["acknowledged_report"])
        self.assertTrue(entry["completed_at"].endswith("Z"))

    def test_mark_completed_merges_extra_and_keeps_other_steps(self):
        state.set_flag("rerank", "skipped", True, path=self.path)
        state.mark_completed("vectors", path=self.path, model="m", documents=3)
        loaded = state.load_state(self.path)
        self.assertEqual(loaded["vectors"]["model"], "m")
        self.assertEqual(loaded["vectors"]["documents"], 3)
        self.assertTrue(loaded["rerank"]["skipped"])
        self.assertEqual(list(self.path.parent.glob("*.tmp")), [])

    def test_load_state_tolerates_missing_and_corrupt_file(self):
        self.assertEqual(state.load_state(self.path), {})
        self.path.parent.mkdir(parents=True)
        self.path.write_text("{not json", encoding="utf-8")
        self.assertEqual(state.load_state(self.path), {})


class TrackedStreamTests(unittest.TestCase):
    def setUp(self):
        jobs.finish_job()
        self.addCleanup(jobs.finish_job)

    def test_tracks_progress_and_runs_on_success_before_yielding_success(self):
        seen = []

        def source():
            yield stream_event("progress", stage="process", progress=42)
            seen.append(jobs.active_job())
            yield stream_event("success", progress=100, document_count=9)

        on_success = mock.Mock()
        stream = jobs.tracked_stream("vectors", source(), on_success=on_success)
        first = next(stream)
        self.assertIn('"progress"', first)
        self.assertEqual(
            jobs.active_job(), {"step": "vectors", "stage": "process", "progress": 42}
        )
        next(stream)
        on_success.assert_called_once()
        self.assertEqual(on_success.call_args.args[0]["document_count"], 9)
        self.assertEqual(seen[0]["step"], "vectors")
        self.assertEqual(list(stream), [])
        self.assertIsNone(jobs.active_job())

    def test_error_stream_does_not_call_on_success(self):
        def source():
            yield stream_event("error", code="error.backend")

        on_success = mock.Mock()
        list(jobs.tracked_stream("rerank", source(), on_success=on_success))
        on_success.assert_not_called()
        self.assertIsNone(jobs.active_job())

    def test_client_disconnect_finishes_job_and_closes_source(self):
        closed = []

        def source():
            try:
                yield stream_event("progress", stage="process", progress=1)
                yield stream_event("progress", stage="process", progress=2)
            finally:
                closed.append(True)

        stream = jobs.tracked_stream("anonymize", source())
        next(stream)
        self.assertEqual(jobs.active_job()["step"], "anonymize")
        stream.close()
        self.assertIsNone(jobs.active_job())
        self.assertEqual(closed, [True])

    def test_overlapping_streams_do_not_clear_each_other(self):
        def source(n):
            for i in range(n):
                yield stream_event("progress", stage="process", progress=i)

        first = jobs.tracked_stream("vectors", source(5))
        next(first)
        second = jobs.tracked_stream("insights", source(5))
        next(second)
        self.assertEqual(jobs.active_job()["step"], "insights")
        next(first)  # progress from the older stream must not touch the slot
        self.assertEqual(jobs.active_job(), {"step": "insights", "stage": "process", "progress": 0})
        first.close()
        self.assertEqual(jobs.active_job()["step"], "insights")
        second.close()
        self.assertIsNone(jobs.active_job())

    def test_exception_in_source_finishes_job(self):
        def source():
            yield stream_event("progress", stage="read", progress=5)
            raise RuntimeError("boom")

        with self.assertRaises(RuntimeError):
            list(jobs.tracked_stream("insights", source()))
        self.assertIsNone(jobs.active_job())


if __name__ == "__main__":
    unittest.main()

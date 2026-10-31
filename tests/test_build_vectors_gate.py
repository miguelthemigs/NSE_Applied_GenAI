"""POST /api/build-vectors refuses to start unless step 1 (anonymize) is done (D7)."""
from __future__ import annotations

from importlib import import_module
import json
import unittest
from unittest import mock

from flask import Flask

vector_routes = import_module("src.api.vector_routes")


def _status(anonymize_state: str) -> dict:
    return {"status": "success", "steps": {"anonymize": {"state": anonymize_state}}}


def ok_stream(**_):
    yield json.dumps({"status": "success", "document_count": 1}) + "\n"


class BuildVectorsGateTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(vector_routes.vector_bp)
        self.client = app.test_client()
        self.stream = mock.patch.object(vector_routes.embedding, "build_vectors_stream", side_effect=ok_stream)
        self.stream_mock = self.stream.start()
        self.addCleanup(self.stream.stop)

    def _post(self, anonymize_state=None, *, side_effect=None, body=None):
        kwargs = {"side_effect": side_effect} if side_effect else {"return_value": _status(anonymize_state)}
        with mock.patch.object(vector_routes.pipeline_status, "build_pipeline_status", **kwargs):
            res = self.client.post("/api/build-vectors", json=body or {})
            payload = b"".join(res.response)
        return res, payload

    def assertBlocked(self, res, payload):
        self.assertEqual(res.status_code, 409)
        body = json.loads(payload)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["code"], "error.blocked")
        self.assertEqual(body["params"], {"step": "anonymize"})
        self.stream_mock.assert_not_called()

    def test_blocked_when_needs_review(self):
        self.assertBlocked(*self._post("needs_review"))

    def test_blocked_when_unverified(self):
        self.assertBlocked(*self._post("unverified"))

    def test_blocked_when_not_started(self):
        self.assertBlocked(*self._post("not_started"))

    def test_blocked_while_step1_runs(self):
        self.assertBlocked(*self._post("in_progress"))

    def test_resume_is_blocked_too(self):
        # Resume is the same endpoint with the checkpoint's model and columns.
        body = {"embedding_model": "Octen/Octen-Embedding-0.6B", "selected_columns": ["Open antwoord"]}
        self.assertBlocked(*self._post("unverified", body=body))

    def test_fails_closed_when_status_cannot_be_built(self):
        self.assertBlocked(*self._post(side_effect=RuntimeError("unreadable state file")))

    def test_allowed_when_done(self):
        res, payload = self._post("done")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'"success"', payload)
        self.stream_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()

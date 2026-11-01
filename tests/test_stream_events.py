import json
import unittest

from src.pipeline.events import STAGES, stream_event


class StreamEventTests(unittest.TestCase):
    def test_progress_event_shape(self) -> None:
        line = stream_event("progress", stage="read", progress=40, message="x")
        self.assertTrue(line.endswith("\n"))
        self.assertEqual(
            json.loads(line),
            {"status": "progress", "stage": "read", "progress": 40, "message": "x"},
        )

    def test_unknown_stage_raises(self) -> None:
        with self.assertRaises(ValueError):
            stream_event("progress", stage="bogus")

    def test_none_omitted_and_extra_kept(self) -> None:
        data = json.loads(stream_event("error", code="error.backend", error="boom"))
        self.assertEqual(data, {"status": "error", "code": "error.backend", "error": "boom"})

    def test_params_and_stages(self) -> None:
        self.assertEqual(STAGES, ("download", "load", "read", "process", "save"))
        data = json.loads(stream_event("progress", stage="process", params={"n": 2}))
        self.assertEqual(data["params"], {"n": 2})


if __name__ == "__main__":
    unittest.main()

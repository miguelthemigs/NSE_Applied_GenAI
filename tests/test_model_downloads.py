"""Visible model downloads and the streaming LLM start (spec D9, Task 14)."""
from __future__ import annotations

import contextlib
from importlib import import_module
import inspect
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock

from flask import Flask

try:
    import isolation  # noqa: F401
except ImportError:  # run as tests.test_model_downloads
    from tests import isolation  # noqa: F401

from src.pipeline import model_downloads
from src.pipeline.model_downloads import DownloadError, ModelNotDownloadedError, download_events, ensure_downloaded

llama_models = import_module("src.pipeline.04_generation.llama_cpp_models")
llm_clients = import_module("src.pipeline.04_generation.llm_clients")
insight_routes = import_module("src.api.insight_routes")

MODEL_12B = "unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL"
FAST = {"min_interval": 0.01, "poll_interval": 0.005}


def _events(gen) -> list[dict]:
    return [json.loads(line) for line in gen]


def _drain(gen):
    """All events plus the generator's return value."""
    events = []
    try:
        while True:
            events.append(json.loads(next(gen)))
    except StopIteration as stop:
        return events, stop.value


def _sibling(name, size):
    return mock.Mock(rfilename=name, size=size)


class DownloadEventsTests(unittest.TestCase):
    def test_progress_is_monotonic_and_ends_at_the_total(self):
        def fake(repo_id, *, on_progress, on_start, **_):
            on_start(100)
            for done in (0, 50, 100):
                on_progress(done, 100)
                time.sleep(0.05)
            return Path("/snap")

        events = _events(download_events("org/model", "quick", downloader=fake, **FAST))
        self.assertGreaterEqual(len(events), 2)
        for event in events:
            self.assertEqual((event["status"], event["stage"]), ("progress", "download"))
            self.assertEqual(event["params"]["tier"], "quick")
            self.assertEqual(event["params"]["bytes_total"], 100)
        done = [e["params"]["bytes_done"] for e in events]
        self.assertEqual(done, sorted(done))
        self.assertEqual(done[-1], 100)

    def test_warm_cache_emits_no_download_event(self):
        # Spike addendum (binding): a warm cache skips the download stage entirely.
        def fake(repo_id, *, on_progress, on_start, **_):
            on_progress(100, 100)  # ensure_downloaded's (total, total) no-op report
            return Path("/snap")

        events, ok = _drain(download_events("org/model", "balanced", downloader=fake, **FAST))
        self.assertEqual(events, [])
        self.assertIs(ok, True)

    def test_downloader_oserror_ends_with_download_failed(self):
        def fake(repo_id, *, on_progress, on_start, **_):
            on_start(100)
            raise OSError("connection reset")

        events, ok = _drain(download_events("org/model", "quick", downloader=fake, **FAST))
        self.assertEqual(events[-1]["status"], "error")
        self.assertEqual(events[-1]["code"], "error.download_failed")
        self.assertIn("connection reset", events[-1]["error"])
        self.assertIs(ok, False)

    def test_unknown_total_is_null(self):
        def fake(repo_id, *, on_progress, on_start, **_):
            on_start(None)
            on_progress(500, 0)
            time.sleep(0.03)
            return Path("/snap")

        events = _events(download_events("org/model", None, downloader=fake, **FAST))
        self.assertTrue(events)
        self.assertTrue(all(e["params"]["bytes_total"] is None for e in events))
        self.assertEqual(events[-1]["params"]["bytes_done"], 500)

    def test_total_never_dips_below_the_seed(self):
        # Partial cache: seed = missing bytes; the bar's total may come in lower (dedup, batches).
        def fake(repo_id, *, on_progress, on_start, **_):
            on_start(1000)
            time.sleep(0.03)
            on_progress(10, 900)
            time.sleep(0.03)
            on_progress(900, 1200)
            time.sleep(0.03)
            return Path("/snap")

        events = _events(download_events("org/model", "quick", downloader=fake, **FAST))
        pairs = [(e["params"]["bytes_done"], e["params"]["bytes_total"]) for e in events]
        self.assertEqual(pairs[0], (0, 1000))
        self.assertIn((10, 1000), pairs)
        self.assertTrue(all(total >= 1000 for _, total in pairs))
        self.assertEqual(pairs[-1], (1200, 1200))

    def test_at_most_one_event_per_interval_plus_a_final_one(self):
        def fake(repo_id, *, on_progress, on_start, **_):
            on_start(1000)
            for i in range(1, 101):
                on_progress(i * 10, 1000)
                time.sleep(0.003)
            return Path("/snap")

        started = time.monotonic()
        events = _events(download_events("org/model", "quick", downloader=fake, min_interval=0.5, poll_interval=0.01))
        elapsed = time.monotonic() - started
        self.assertLessEqual(len(events), int(elapsed / 0.5) + 2)
        self.assertEqual(events[-1]["params"]["bytes_done"], 1000)


class EnsureDownloadedTests(unittest.TestCase):
    def setUp(self):
        self.api = mock.Mock()
        self.api.return_value.model_info.return_value = mock.Mock(
            siblings=[
                _sibling("README.md", 30),
                _sibling("model-UD-Q4_K_XL.gguf", 900),
                _sibling("mmproj-BF16.gguf", 100),
            ]
        )
        patches = [
            mock.patch("huggingface_hub.HfApi", self.api),
            mock.patch.dict("os.environ", {"HF_HUB_OFFLINE": ""}),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_warm_cache_is_a_no_op_reporting_total_total(self):
        cached = {"model-UD-Q4_K_XL.gguf": "/c/snapshots/abc/model-UD-Q4_K_XL.gguf", "mmproj-BF16.gguf": "/c/snapshots/abc/mmproj-BF16.gguf"}
        progress, starts = [], []
        with (
            mock.patch("huggingface_hub.try_to_load_from_cache", side_effect=lambda repo, name, **_: cached.get(name)),
            mock.patch("huggingface_hub.snapshot_download") as snap,
        ):
            path = ensure_downloaded(
                "org/model", allow_patterns=["*UD-Q4_K_XL*.gguf", "mmproj*"],
                on_progress=lambda d, t: progress.append((d, t)), on_start=starts.append,
            )
        snap.assert_not_called()
        self.assertEqual(starts, [])
        self.assertEqual(progress, [(1000, 1000)])
        self.assertEqual(path, Path("/c/snapshots/abc"))

    def test_partial_cache_seeds_the_missing_bytes_and_downloads(self):
        cached = {"mmproj-BF16.gguf": "/c/snapshots/abc/mmproj-BF16.gguf"}
        starts = []
        with (
            mock.patch("huggingface_hub.try_to_load_from_cache", side_effect=lambda repo, name, **_: cached.get(name)),
            mock.patch("huggingface_hub.snapshot_download", return_value="/c/snapshots/abc") as snap,
        ):
            ensure_downloaded("org/model", allow_patterns=["*.gguf"], on_progress=lambda d, t: None, on_start=starts.append)
        self.assertEqual(starts, [900])
        kwargs = snap.call_args.kwargs
        self.assertEqual(kwargs["allow_patterns"], ["*.gguf"])
        self.assertIsNotNone(kwargs["tqdm_class"])

    def test_download_error_is_wrapped(self):
        with (
            mock.patch("huggingface_hub.try_to_load_from_cache", return_value=None),
            mock.patch("huggingface_hub.snapshot_download", side_effect=OSError("disk full")),
        ):
            with self.assertRaisesRegex(DownloadError, "disk full"):
                ensure_downloaded("org/model", allow_patterns=["*.gguf"], on_progress=lambda d, t: None)

    def test_no_matching_files_is_an_error(self):
        with self.assertRaises(DownloadError):
            ensure_downloaded("org/model", allow_patterns=["*Q8_0*.gguf"], on_progress=lambda d, t: None)

    def test_hub_unreachable_and_not_cached_fails_clearly(self):
        self.api.return_value.model_info.side_effect = OSError("no route to host")
        with tempfile.TemporaryDirectory() as cache, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(DownloadError):
                ensure_downloaded("org/model", allow_patterns=["*.gguf"], on_progress=lambda d, t: None, cache_dir=cache)

    def test_offline_with_complete_cache_skips_the_hub(self):
        with tempfile.TemporaryDirectory() as cache:
            root = Path(cache) / "models--org--model"
            (root / "refs").mkdir(parents=True)
            (root / "refs" / "main").write_text("abc")
            snap = root / "snapshots" / "abc"
            snap.mkdir(parents=True)
            (snap / "model-UD-Q4_K_XL.gguf").write_bytes(b"x" * 7)
            progress = []
            with mock.patch.dict("os.environ", {"HF_HUB_OFFLINE": "1"}):
                path = ensure_downloaded(
                    "org/model", allow_patterns=["*UD-Q4_K_XL*.gguf"],
                    on_progress=lambda d, t: progress.append((d, t)), cache_dir=cache,
                )
            self.api.assert_not_called()
            self.assertEqual(path.resolve(), snap.resolve())
            self.assertEqual(progress, [(7, 7)])

    def test_offline_cache_must_match_every_pattern(self):
        with tempfile.TemporaryDirectory() as cache:
            root = Path(cache) / "models--org--model"
            (root / "refs").mkdir(parents=True)
            (root / "refs" / "main").write_text("abc")
            snap = root / "snapshots" / "abc"
            snap.mkdir(parents=True)
            (snap / "model-UD-Q4_K_XL.gguf").write_bytes(b"x")
            with mock.patch.dict("os.environ", {"HF_HUB_OFFLINE": "1"}):
                with self.assertRaises(DownloadError):
                    ensure_downloaded(
                        "org/model", allow_patterns=["*UD-Q4_K_XL*.gguf", "mmproj-BF16.gguf"],
                        on_progress=lambda d, t: None, cache_dir=cache,
                    )

    def test_offline_without_cache_fails_clearly(self):
        with tempfile.TemporaryDirectory() as cache, mock.patch.dict("os.environ", {"HF_HUB_OFFLINE": "1"}):
            with self.assertRaises(DownloadError):
                ensure_downloaded("org/model", allow_patterns=["*.gguf"], on_progress=lambda d, t: None, cache_dir=cache)


class ProgressBarSelectionTests(unittest.TestCase):
    def _tqdm(self, seen):
        return model_downloads._ByteBarTracker(lambda d, t: seen.append((d, t))).tqdm_class()

    def test_only_the_aggregate_byte_bar_is_published(self):
        seen = []
        cls = self._tqdm(seen)
        files = cls(desc="Fetching 2 files", unit="it", total=2)
        files.update(1)
        agg = cls(desc=model_downloads.AGGREGATE_BAR_DESC, unit="B", total=0)
        rebuild = cls(desc="Reconstructing (incomplete total...)", unit="B", total=0)
        agg.total = 1000
        rebuild.total = 5000
        agg.update(400)
        rebuild.update(4000)  # re-counts the same bytes: ignored once the aggregate bar exists
        self.assertEqual(seen, [(400, 1000)])

    def test_fallback_is_the_byte_bar_with_the_largest_total(self):
        seen = []
        cls = self._tqdm(seen)
        small = cls(desc="file a", unit="B", total=100)
        big = cls(desc="file b", unit="B", total=900)
        small.update(50)
        big.update(300)
        small.update(10)  # smaller total than the bar already chosen
        self.assertEqual(seen, [(50, 100), (300, 900)])

    def test_concurrent_updates_publish_in_order(self):
        seen, active, overlaps = [], [0], []

        def on_progress(done, total):
            active[0] += 1
            if active[0] > 1:
                overlaps.append(done)
            seen.append(done)
            time.sleep(0)  # invite a thread switch inside the callback
            active[0] -= 1

        cls = model_downloads._ByteBarTracker(on_progress).tqdm_class()
        agg = cls(desc=model_downloads.AGGREGATE_BAR_DESC, unit="B", total=8 * 300)
        start = threading.Barrier(8)

        def worker():
            start.wait()
            for _ in range(300):
                agg.update(1)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(overlaps, [])
        self.assertEqual(seen, sorted(seen))
        self.assertEqual(len(seen), 2400)
        self.assertEqual(seen[-1], 2400)

    def test_aggregate_desc_matches_installed_huggingface_hub(self):
        source = inspect.getsource(import_module("huggingface_hub._snapshot_download"))
        self.assertIn(f'desc="{model_downloads.AGGREGATE_BAR_DESC}"', source)


class GgufPatternTests(unittest.TestCase):
    SIBLINGS_12B = [
        "MTP/mtp-gemma-4-12B-it-BF16.gguf",
        "MTP/mtp-gemma-4-12B-it-Q4_0.gguf",
        "README.md",
        "gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",
        "mmproj-BF16.gguf",
        "mmproj-F16.gguf",
        "mmproj-F32.gguf",
        "mtp-gemma-4-12B-it.gguf",
    ]

    def test_patterns_select_exactly_what_llama_server_loads(self):
        from huggingface_hub.utils import filter_repo_objects

        model = llama_models.resolve_llama_cpp_model(MODEL_12B)
        chosen = sorted(filter_repo_objects(self.SIBLINGS_12B, allow_patterns=model.download_patterns))
        self.assertEqual(chosen, ["gemma-4-12B-it-qat-UD-Q4_K_XL.gguf", "mmproj-BF16.gguf", "mtp-gemma-4-12B-it.gguf"])


class LlamaServerLaunchTests(unittest.TestCase):
    def test_command_is_offline_and_keeps_mtp_args_last(self):
        command = llama_models.resolve_llama_cpp_model(MODEL_12B).server_command("llama-server")
        self.assertEqual(command[1:4], ["-hf", MODEL_12B, "--offline"])
        self.assertEqual(command[-4:], ["--spec-type", "draft-mtp", "--spec-draft-n-max", "2"])

    def test_server_gets_the_same_cache_as_snapshot_download(self):
        env = llm_clients.llama_server_env()
        cache = model_downloads.hub_cache_dir()
        self.assertEqual(env["HF_HUB_CACHE"], cache)
        self.assertEqual(env["LLAMA_CACHE"], cache)

    def _start(self, client, **patches):
        """Run _start_llama_server with the process plumbing mocked; returns (order, popen)."""
        order = []
        process = mock.Mock(pid=4321)
        process.poll.return_value = None
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.object(llm_clients.LlamaCppClient, "_managed_process", None),
            mock.patch.object(llm_clients.LlamaCppClient, "_managed_log_path", Path(tmp) / "llama.log"),
            mock.patch.object(llm_clients.LlamaCppClient, "_managed_pid_path", Path(tmp) / "llama.pid"),
            mock.patch.object(client, "_check_llama_server_binary"),
            mock.patch.object(llm_clients.subprocess, "Popen", side_effect=lambda *a, **k: order.append("popen") or process) as popen,
            mock.patch.object(client, "_wait_until_server_ready", side_effect=lambda *_: order.append("wait")),
        ):
            client._start_llama_server(MODEL_12B)
        return order, popen

    def test_local_files_are_checked_before_the_server_starts(self):
        client = llm_clients.LlamaCppClient()
        calls = []
        with mock.patch.object(model_downloads, "require_local", side_effect=lambda *a, **k: calls.append(a)):
            order, popen = self._start(client)
        self.assertEqual(order, ["popen", "wait"])
        model = llama_models.resolve_llama_cpp_model(MODEL_12B)
        self.assertEqual(calls, [(model.repo_id, model.download_patterns)])
        self.assertEqual(popen.call_args.kwargs["env"]["HF_HUB_CACHE"], model_downloads.hub_cache_dir())

    def test_missing_files_raise_fast_and_never_download(self):
        from huggingface_hub.errors import LocalEntryNotFoundError

        client = llm_clients.LlamaCppClient()

        def local_only(*args, **kwargs):
            if not kwargs.get("local_files_only"):
                raise AssertionError("tried to download")
            raise LocalEntryNotFoundError("not cached")

        started = time.monotonic()
        with (
            mock.patch("huggingface_hub.snapshot_download", side_effect=local_only) as snap,
            mock.patch("huggingface_hub.HfApi") as api,
        ):
            with self.assertRaisesRegex(ModelNotDownloadedError, "model not downloaded; start it from step 4"):
                self._start(client)
        self.assertLess(time.monotonic() - started, 2)
        self.assertTrue(snap.called)
        self.assertTrue(all(c.kwargs.get("local_files_only") for c in snap.call_args_list))
        api.assert_not_called()


class ThemeSummaryModelMissingTests(unittest.TestCase):
    def test_uncached_model_returns_model_missing_quickly(self):
        import requests
        from huggingface_hub.errors import LocalEntryNotFoundError

        app = Flask(__name__)
        app.register_blueprint(insight_routes.insight_bp)
        generation = insight_routes.generation
        client = llm_clients.LlamaCppClient()
        started = time.monotonic()
        with (
            mock.patch.object(generation, "load_cache", return_value={}),
            mock.patch.object(generation.retrieval, "get_collection", return_value=mock.Mock()),
            mock.patch.object(generation, "get_llm_client", return_value=client),
            mock.patch.object(client, "_get_router_models", side_effect=requests.exceptions.ConnectionError("down")),
            mock.patch.object(client, "_check_llama_server_binary"),
            mock.patch.object(client, "unload"),
            mock.patch.object(llm_clients.LlamaCppClient, "_managed_process", None),
            mock.patch("huggingface_hub.snapshot_download", side_effect=LocalEntryNotFoundError("not cached")) as snap,
            mock.patch.object(llm_clients.subprocess, "Popen") as popen,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            res = app.test_client().post(
                "/api/theme-summary",
                json={"theme": "Teachers", "query": "Teachers", "llm_model": MODEL_12B, "allow_model_download": True},
            )
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(res.status_code, 409)
        body = res.get_json()
        self.assertEqual(body["code"], "error.model_missing")
        self.assertIn("start it from step 4", body["error"])
        self.assertTrue(all(c.kwargs.get("local_files_only") for c in snap.call_args_list))
        popen.assert_not_called()


class StartStreamRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(insight_routes.insight_bp)
        self.client = app.test_client()

    def _post(self, body):
        res = self.client.post("/api/llm-models/start-stream", json=body)
        return res, [json.loads(line) for line in res.get_data(as_text=True).splitlines() if line.strip()]

    def test_server_timeout_gives_llm_unavailable_fast_without_retries(self):
        llm = mock.Mock()
        llm.ensure_model_available.side_effect = RuntimeError("Timed out waiting for llama-server after 180s.")
        started = time.monotonic()
        with (
            mock.patch.object(model_downloads, "ensure_downloaded", return_value=Path("/snap")),
            mock.patch.object(insight_routes.generation, "get_llm_client", return_value=llm),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            res, events = self._post({"model_id": MODEL_12B})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, "application/x-ndjson")
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(events[-1]["status"], "error")
        self.assertEqual(events[-1]["code"], "error.llm_unavailable")
        llm.ensure_model_available.assert_called_once_with(MODEL_12B, allow_download=True)

    def test_download_then_load_then_success(self):
        def fake_ensure(repo_id, *, on_progress, on_start=None, **_):
            on_start(200)
            on_progress(200, 200)
            time.sleep(0.02)
            return Path("/snap")

        llm = mock.Mock()
        with (
            mock.patch.object(model_downloads, "ensure_downloaded", side_effect=fake_ensure),
            mock.patch.object(insight_routes.generation, "get_llm_client", return_value=llm),
        ):
            _, events = self._post({"model_id": MODEL_12B})
        stages = [e.get("stage") for e in events if e["status"] == "progress"]
        self.assertEqual(stages[0], "download")
        self.assertEqual(stages[-1], "load")
        self.assertEqual(events[-1]["status"], "success")
        self.assertEqual(events[-1]["params"]["model"], MODEL_12B)
        downloads = [e for e in events if e.get("stage") == "download"]
        self.assertEqual(downloads[-1]["params"], {"bytes_done": 200, "bytes_total": 200, "tier": "balanced", "repo": "unsloth/gemma-4-12B-it-qat-GGUF"})

    def test_download_failure_stops_before_the_server_starts(self):
        llm = mock.Mock()
        with (
            mock.patch.object(model_downloads, "ensure_downloaded", side_effect=DownloadError("offline")),
            mock.patch.object(insight_routes.generation, "get_llm_client", return_value=llm),
        ):
            _, events = self._post({"model_id": MODEL_12B})
        self.assertEqual(events[-1]["code"], "error.download_failed")
        llm.ensure_model_available.assert_not_called()

    def test_missing_model_at_start_maps_to_model_missing(self):
        llm = mock.Mock()
        llm.ensure_model_available.side_effect = ModelNotDownloadedError("model not downloaded; start it from step 4")
        with (
            mock.patch.object(model_downloads, "ensure_downloaded", return_value=Path("/snap")),
            mock.patch.object(insight_routes.generation, "get_llm_client", return_value=llm),
        ):
            _, events = self._post({"model_id": MODEL_12B})
        self.assertEqual(events[-1]["code"], "error.model_missing")

    def test_unknown_model_is_a_400(self):
        res = self.client.post("/api/llm-models/start-stream", json={"model_id": "nope"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.get_json()["code"], "error.backend")


class VectorBuildDownloadTests(unittest.TestCase):
    """The embedding model downloads visibly before it loads (step 2)."""

    def _build(self, fake_events):
        vector_builder = import_module("src.pipeline.02_embedding.vector_builder")
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "anon.csv"
            csv_path.write_text("Open antwoord\nGoede docenten\n", encoding="utf-8")
            with (
                mock.patch.object(model_downloads, "download_events", side_effect=fake_events) as events,
                mock.patch.object(vector_builder, "load_embedding_model", side_effect=RuntimeError("stop after load")) as load,
            ):
                out = _events(vector_builder.build_vector_db_stream(
                    csv_path=str(csv_path), db_path=str(Path(tmp) / "db"),
                    embedding_model="Octen/Octen-Embedding-0.6B", selected_columns=["Open antwoord"],
                    allow_model_download=True,
                ))
        return out, events, load

    def test_download_events_come_before_the_load_stage(self):
        def fake(repo_id, tier, **kw):
            yield model_downloads._download_event({"done": 5, "total": 5}, tier, repo_id)
            return True

        out, events, load = self._build(fake)
        stages = [e.get("stage") for e in out if e["status"] == "progress"]
        self.assertLess(stages.index("download"), stages.index("load"))
        self.assertEqual(events.call_args.args, ("Octen/Octen-Embedding-0.6B", "balanced"))
        self.assertEqual(events.call_args.kwargs["allow_patterns"], model_downloads.EMBEDDING_ALLOW_PATTERNS)
        load.assert_called_once()

    def test_failed_download_stops_before_loading(self):
        def fake(repo_id, tier, **kw):
            yield json.dumps({"status": "error", "code": "error.download_failed"}) + "\n"
            return False

        out, _, load = self._build(fake)
        self.assertEqual(out[-1]["code"], "error.download_failed")
        load.assert_not_called()


class PrecomputeModelMissingTests(unittest.TestCase):
    def test_missing_model_ends_the_run_with_model_missing(self):
        generation = insight_routes.generation
        llm = mock.Mock()
        llm.ensure_model_available.side_effect = ModelNotDownloadedError("model not downloaded; start it from step 4")
        with (
            mock.patch.object(generation, "load_cache", return_value={}),
            mock.patch.object(generation, "get_llm_client", return_value=llm),
        ):
            events = _events(generation.precompute_insights_stream(
                themes=[{"name": "Teachers"}, {"name": "Assessment"}],
                llm_model=MODEL_12B, allow_model_download=True,
            ))
        self.assertEqual(events[-1]["status"], "error")
        self.assertEqual(events[-1]["code"], "error.model_missing")
        self.assertFalse(any(e["status"] == "success" for e in events))
        llm.ensure_model_available.assert_called_once()


class FrontendTierCopyTests(unittest.TestCase):
    def test_frontend_fallback_tiers_equal_backend_tiers(self):
        from src.config.model_tiers import TIERS

        path = Path(__file__).resolve().parents[1] / "dashboard" / "src" / "config" / "modelTiers.json"
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), TIERS)


if __name__ == "__main__":
    unittest.main()

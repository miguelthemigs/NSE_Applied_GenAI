"""Visible model downloads (spec D9; mechanism from the Task 12 spike).

`ensure_downloaded()` fetches a Hugging Face repo into the shared HF cache with
`snapshot_download(tqdm_class=...)`, so the loaders (SentenceTransformer,
CrossEncoder, `llama-server -hf ... --offline`) then read local files only.
`download_events()` turns that into NDJSON `stage:"download"` events: at most
one per 500 ms, plus a final one. A warm cache emits no download event.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import time
from typing import Callable, Generator, Iterable

from src.pipeline import jobs
from src.pipeline.events import stream_event

# snapshot_download's one aggregate byte bar (pinned by a test against the installed version).
AGGREGATE_BAR_DESC = "Downloading bytes"
MIN_EVENT_INTERVAL = 0.5
POLL_INTERVAL = 0.1
HUB_TIMEOUT_SECONDS = 3
# What SentenceTransformer / CrossEncoder load: configs, tokenizer, weights, module folders.
EMBEDDING_ALLOW_PATTERNS = ("*.json", "*.safetensors", "*.txt", "*.jinja", "*.model")

ProgressCallback = Callable[[int | None, int | None], None]


class DownloadError(RuntimeError):
    """The model is not on this computer and could not be downloaded."""


def hub_cache_dir() -> str:
    """The HF hub cache that snapshot_download, the loaders and llama-server all use."""
    from huggingface_hub import constants

    return constants.HF_HUB_CACHE


def _offline() -> bool:
    return os.environ.get("HF_HUB_OFFLINE", "").strip().lower() in {"1", "true", "yes"}


def _patterns(allow_patterns: Iterable[str] | None) -> list[str] | None:
    return list(allow_patterns) if allow_patterns else None


def _matching(names: Iterable[str], allow_patterns: list[str] | None) -> list[str]:
    from huggingface_hub.utils import filter_repo_objects

    return list(filter_repo_objects(list(names), allow_patterns=allow_patterns))


def hub_file_sizes(repo_id: str, allow_patterns: Iterable[str] | None = None, *, timeout: float = HUB_TIMEOUT_SECONDS) -> dict[str, int | None]:
    """{filename: size} for the repo files that `allow_patterns` selects. Raises on Hub errors."""
    from huggingface_hub import HfApi

    info = HfApi().model_info(repo_id, files_metadata=True, timeout=timeout)
    siblings = {s.rfilename: getattr(s, "size", None) for s in (info.siblings or [])}
    chosen = set(_matching(siblings, _patterns(allow_patterns)))
    return {name: size for name, size in siblings.items() if name in chosen}


@dataclass(frozen=True)
class DownloadPlan:
    total_bytes: int | None
    missing_bytes: int
    missing_files: tuple[str, ...]
    snapshot: Path | None


def plan_download(repo_id: str, allow_patterns: Iterable[str] | None = None, cache_dir: str | None = None) -> DownloadPlan | None:
    """What is missing locally, from Hub sizes minus cached files. None when the Hub can't be asked."""
    if _offline():
        return None
    try:
        sizes = hub_file_sizes(repo_id, allow_patterns)
    except Exception as exc:
        print(f"[MODEL DOWNLOAD] Hub lookup for {repo_id} failed, checking the local cache: {exc}")
        return None
    if not sizes:
        raise DownloadError(f"No files in {repo_id} match {list(allow_patterns or [])}.")

    from huggingface_hub import try_to_load_from_cache

    missing: list[str] = []
    snapshot: Path | None = None
    for name in sizes:
        hit = try_to_load_from_cache(repo_id, name, cache_dir=cache_dir)
        if isinstance(hit, str):
            snapshot = snapshot or Path(hit).parents[name.count("/")]
        else:
            missing.append(name)
    total = sum(size or 0 for size in sizes.values()) or None
    missing_bytes = sum(sizes[name] or 0 for name in missing)
    return DownloadPlan(total, missing_bytes, tuple(missing), snapshot)


def _local_snapshot(repo_id: str, allow_patterns: list[str] | None, cache_dir: str | None) -> tuple[Path, int]:
    """The cached snapshot when the Hub can't be reached; DownloadError when nothing usable is cached."""
    from huggingface_hub import snapshot_download

    reason = "offline mode is on (HF_HUB_OFFLINE)" if _offline() else "the Hugging Face Hub cannot be reached"
    try:
        path = Path(snapshot_download(repo_id, allow_patterns=allow_patterns, cache_dir=cache_dir, local_files_only=True))
    except Exception as exc:
        raise DownloadError(f"{repo_id} is not on this computer and {reason}.") from exc
    files = {p.relative_to(path).as_posix(): p for p in path.rglob("*") if p.is_file()}
    chosen = _matching(files, allow_patterns)
    if not chosen:
        raise DownloadError(f"{repo_id} is not on this computer and {reason}.")
    return path, sum(files[name].stat().st_size for name in chosen)


class _ByteBarTracker:
    """Picks the one byte bar worth showing and forwards its (n, total).

    snapshot_download creates several bars: "Fetching N files" (unit "it"), the
    aggregate "Downloading bytes" bar, and a "Reconstructing" bar that re-counts
    the same bytes. Use the aggregate bar; without one, the unit "B" bar with
    the largest total. Bars update from several download threads at once.
    """

    def __init__(self, on_progress: ProgressCallback):
        self._on_progress = on_progress
        self._choice = jobs.ProgressSnapshot({"bar": None, "key": None, "done": 0, "total": None})

    def last(self) -> tuple[int, int | None]:
        _, state = self._choice.read()
        return state["done"], state["total"]

    def observe(self, bar) -> None:
        if getattr(bar, "unit", None) != "B":
            return
        total = int(bar.total) if bar.total else None
        done = int(bar.n or 0)
        key = (getattr(bar, "desc", "") == AGGREGATE_BAR_DESC, total or 0)

        def choose(state: dict) -> bool:
            if state["bar"] not in (None, id(bar)) and key < state["key"]:
                return False
            state.update(bar=id(bar), key=key, done=done, total=total)
            return True

        if self._choice.mutate(choose):
            self._on_progress(done, total)

    def tqdm_class(self) -> type:
        from tqdm.auto import tqdm

        tracker = self

        class ProgressTqdm(tqdm):
            def __init__(self, *args, **kwargs):
                kwargs["file"] = _NullWriter()  # quiet; the bar still counts n
                super().__init__(*args, **kwargs)

            def update(self, n=1):
                result = super().update(n)
                tracker.observe(self)
                return result

        return ProgressTqdm


class _NullWriter:
    def write(self, _text) -> None:
        pass

    def flush(self) -> None:
        pass


def ensure_downloaded(
    repo_id: str,
    *,
    allow_patterns: Iterable[str] | None = None,
    on_progress: ProgressCallback,
    on_start: Callable[[int | None], None] | None = None,
    cache_dir: str | None = None,
) -> Path:
    """Make the selected repo files local and return the snapshot folder.

    Everything cached: a no-op that reports `(total, total)`. Otherwise
    `on_start(missing_bytes)` runs once, then `on_progress(done, total)` follows
    the aggregate byte bar (its own base: only the missing bytes), and a final
    `(total, total)` when snapshot_download returns. Raises DownloadError.
    """
    patterns = _patterns(allow_patterns)
    plan = plan_download(repo_id, patterns, cache_dir)
    if plan is None:
        path, size = _local_snapshot(repo_id, patterns, cache_dir)
        on_progress(size, size)
        return path
    if not plan.missing_files and plan.snapshot is not None:
        on_progress(plan.total_bytes, plan.total_bytes)
        return plan.snapshot

    if on_start is not None:
        on_start(plan.missing_bytes or None)
    tracker = _ByteBarTracker(on_progress)
    from huggingface_hub import snapshot_download

    try:
        path = snapshot_download(repo_id, allow_patterns=patterns, cache_dir=cache_dir, tqdm_class=tracker.tqdm_class())
    except Exception as exc:
        raise DownloadError(f"Downloading {repo_id} failed: {exc}") from exc
    done, total = tracker.last()
    final = total or plan.missing_bytes or None
    on_progress(final if final else done, final)
    return Path(path)


def _apply_progress(done: int | None, total: int | None) -> Callable[[dict], None]:
    def apply(state: dict) -> None:
        if not state["started"]:
            return  # warm cache: ensure_downloaded's no-op report is not a download
        new_total = total or None
        if state["from_bar"]:
            new_done = max(state["done"], done or 0)
        else:
            new_done = done or 0  # first bar update: switch base in one step, never mix
        if new_total is not None:
            new_done = min(new_done, new_total)
        state.update(from_bar=True, done=new_done, total=new_total)

    return apply


def _download_event(state: dict, tier: str | None, repo_id: str) -> str:
    params = {"bytes_done": state["done"], "bytes_total": state["total"], "tier": tier, "repo": repo_id}
    return stream_event("progress", stage="download", params=params)


def download_events(
    repo_id: str,
    tier: str | None,
    *,
    downloader: Callable[..., Path] | None = None,
    min_interval: float = MIN_EVENT_INTERVAL,
    poll_interval: float = POLL_INTERVAL,
    **kw,
) -> Generator[str, None, bool]:
    """NDJSON download events for `repo_id`; returns True when the files are local.

    The download runs on a background thread (jobs.BackgroundCall). This
    publisher yields at most one event per `min_interval`, plus a final event
    with `bytes_done == bytes_total`. Nothing is yielded for a warm cache. On
    failure it yields one `error.download_failed` event and returns False.
    """
    downloader = downloader or ensure_downloaded
    progress = jobs.ProgressSnapshot({"started": False, "from_bar": False, "done": 0, "total": None})

    def on_start(missing: int | None) -> None:
        progress.mutate(lambda s: s.update(started=True, from_bar=False, done=0, total=missing or None))

    def on_progress(done: int | None, total: int | None) -> None:
        progress.mutate(_apply_progress(done, total))

    call = jobs.BackgroundCall(downloader, repo_id, on_progress=on_progress, on_start=on_start, **kw)
    last_emit: float | None = None
    last_version: int | None = None
    while not call.wait(poll_interval):
        version, state = progress.read()
        now = time.monotonic()
        if state["started"] and version != last_version and (last_emit is None or now - last_emit >= min_interval):
            yield _download_event(state, tier, repo_id)
            last_emit, last_version = now, version

    if call.error is not None:
        yield stream_event(
            "error",
            stage="download",
            code="error.download_failed",
            params={"tier": tier, "repo": repo_id},
            error=str(call.error),
        )
        return False
    _, state = progress.read()
    if state["started"]:
        total = state["total"]
        yield _download_event({"done": total if total else state["done"], "total": total}, tier, repo_id)
    return True

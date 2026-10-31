"""In-process registry of the one pipeline job that is currently streaming.

The registry lives in memory on purpose: after a backend restart there is no
active job, so a half-finished step reads as `interrupted`, never as
`in_progress` forever. All thread-safe code for pipeline state lives here
(`app.py` must not import `threading`).
"""
import json
import threading
from typing import Callable, Iterable, Iterator

_lock = threading.Lock()
_active: dict | None = None

# Guards read-modify-write cycles on data/pipeline_state.json (see state.py).
state_lock = threading.Lock()


def start_job(step: str) -> None:
    global _active
    with _lock:
        _active = {"step": step, "stage": None, "progress": 0}


def update_job(stage: str | None, progress: float | None) -> None:
    with _lock:
        if _active is None:
            return
        if stage is not None:
            _active["stage"] = stage
        if progress is not None:
            _active["progress"] = progress


def finish_job() -> None:
    global _active
    with _lock:
        _active = None


def active_job() -> dict | None:
    with _lock:
        return dict(_active) if _active is not None else None


def tracked_stream(
    step: str,
    stream: Iterable[str],
    *,
    on_success: Callable[[dict], None] | None = None,
) -> Iterator[str]:
    """Wrap an NDJSON stream so the registry follows it.

    Progress events update the active job (one lock acquire per event). On the
    success event, `on_success(event)` runs *before* the line is yielded, so a
    client that disconnects right after success still leaves the state saved.
    `finish_job()` always runs, including on client disconnect (GeneratorExit).
    """
    start_job(step)
    try:
        for line in stream:
            event = _parse_event(line)
            if event is not None:
                status = event.get("status")
                if status == "progress":
                    update_job(event.get("stage"), event.get("progress"))
                elif status == "success" and on_success is not None:
                    try:
                        on_success(event)
                    except Exception as exc:  # never break the user's stream
                        print(f"[PIPELINE STATE] Warning: could not record {step}: {exc}")
            yield line
    finally:
        finish_job()
        close = getattr(stream, "close", None)
        if close is not None:
            close()


def _parse_event(line) -> dict | None:
    try:
        event = json.loads(line)
    except (TypeError, ValueError):
        return None
    return event if isinstance(event, dict) else None

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


def _start(step: str) -> dict:
    global _active
    token = {"step": step, "stage": None, "progress": 0}
    with _lock:
        _active = token
    return token


def _update(token: dict | None, stage: str | None, progress: float | None) -> None:
    """Update the slot; with a token, only if the slot still belongs to it."""
    with _lock:
        if _active is None or (token is not None and _active is not token):
            return
        if stage is not None:
            _active["stage"] = stage
        if progress is not None:
            _active["progress"] = progress


def _finish(token: dict | None) -> None:
    """Clear the slot; with a token, only if the slot still belongs to it."""
    global _active
    with _lock:
        if token is None or _active is token:
            _active = None


def start_job(step: str) -> None:
    _start(step)


def update_job(stage: str | None, progress: float | None) -> None:
    _update(None, stage, progress)


def finish_job() -> None:
    _finish(None)


def active_job() -> dict | None:
    with _lock:
        return dict(_active) if _active is not None else None


def tracked_stream(
    step: str,
    stream: Iterable[str],
    *,
    on_start: Callable[[], None] | None = None,
    on_success: Callable[[dict], None] | None = None,
) -> Iterator[str]:
    """Wrap an NDJSON stream so the registry follows it.

    `on_start()` runs when the stream starts. Progress events update this
    stream's job slot (one lock acquire per event). On the success event,
    `on_success(event)` runs *before* the line is yielded, so a client that
    disconnects right after success still leaves the state saved. The slot is
    always released, including on client disconnect (GeneratorExit), but only
    if it still belongs to this stream, so overlapping streams don't clear
    each other.
    """
    token = _start(step)
    try:
        if on_start is not None:
            _run_hook(step, on_start)
        for line in stream:
            event = _parse_event(line)
            if event is not None:
                status = event.get("status")
                if status == "progress":
                    _update(token, event.get("stage"), event.get("progress"))
                elif status == "success" and on_success is not None:
                    _run_hook(step, on_success, event)
            yield line
    finally:
        _finish(token)
        close = getattr(stream, "close", None)
        if close is not None:
            close()


def _run_hook(step: str, hook: Callable, *args) -> None:
    try:
        hook(*args)
    except Exception as exc:  # never break the user's stream
        print(f"[PIPELINE STATE] Warning: could not record {step}: {exc}")


def _parse_event(line) -> dict | None:
    try:
        event = json.loads(line)
    except (TypeError, ValueError):
        return None
    return event if isinstance(event, dict) else None

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


class JobBusy(Exception):
    """Another pipeline job holds the slot; `step` is the one that is running."""

    def __init__(self, step: str | None):
        super().__init__(f"Another step is running: {step}")
        self.step = step


def try_start(step: str) -> dict | None:
    """Take the job slot for `step` atomically; None when a job already runs."""
    token, _running = _try_start(step)
    return token


def _try_start(step: str) -> tuple[dict | None, str | None]:
    global _active
    with _lock:
        if _active is not None:
            return None, _active["step"]
        token = {"step": step, "stage": None, "progress": 0}
        _active = token
        return token, None


def tracked_stream(
    step: str,
    stream: Iterable[str],
    *,
    on_start: Callable[[], None] | None = None,
    on_success: Callable[[dict], None] | None = None,
) -> Iterator[str]:
    """Wrap an NDJSON stream so the registry follows it.

    The job slot is taken right away, before the first event, so a route can
    still answer 409: raises `JobBusy` (and closes `stream`) when another job
    already runs. `on_start()` runs when the stream starts. Progress events
    update this stream's job slot (one lock acquire per event). On the success
    event, `on_success(event)` runs *before* the line is yielded, so a client
    that disconnects right after success still leaves the state saved. The
    slot is always released, including on client disconnect (GeneratorExit)
    and when the response is closed before it was ever read.
    """
    token, running = _try_start(step)
    if token is None:
        _close(stream)
        raise JobBusy(running)
    return _TrackedStream(token, stream, _run_tracked(step, token, stream, on_start, on_success))


class _TrackedStream:
    """The tracked generator plus a close() that also frees a never-started slot."""

    def __init__(self, token: dict, source: Iterable[str], generator: Iterator[str]):
        self._token = token
        self._source = source
        self._generator = generator

    def __iter__(self):
        return self

    def __next__(self) -> str:
        return next(self._generator)

    def close(self) -> None:
        try:
            self._generator.close()
        finally:
            _finish(self._token)
            _close(self._source)


def _run_tracked(step, token, stream, on_start, on_success) -> Iterator[str]:
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
        _close(stream)


def _close(stream) -> None:
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


class ProgressSnapshot:
    """A small dict that worker threads change and a reader copies, under one lock.

    `mutate(fn)` runs `fn(state)` under the lock, bumps the version and returns
    fn's result; `read()` returns `(version, copy)`, so a publisher can tell
    whether anything changed since it last looked.
    """

    def __init__(self, initial: dict | None = None):
        self._lock = threading.Lock()
        self._state = dict(initial or {})
        self._version = 0

    def mutate(self, fn: Callable[[dict], object]):
        with self._lock:
            result = fn(self._state)
            self._version += 1
            return result

    def read(self) -> tuple[int, dict]:
        with self._lock:
            return self._version, dict(self._state)


class BackgroundCall:
    """Runs `fn(*args, **kwargs)` on a daemon thread; keeps its result or error.

    A client that disconnects mid-stream does not stop the call: a model
    download simply finishes in the background.
    """

    def __init__(self, fn: Callable, *args, **kwargs):
        self.result = None
        self.error: BaseException | None = None
        self._thread = threading.Thread(target=self._run, args=(fn, args, kwargs), daemon=True)
        self._thread.start()

    def _run(self, fn, args, kwargs) -> None:
        try:
            self.result = fn(*args, **kwargs)
        except BaseException as exc:  # reported to the stream, never raised in the thread
            self.error = exc

    def wait(self, timeout: float | None = None) -> bool:
        """Wait up to `timeout` seconds; True once the call has finished."""
        self._thread.join(timeout)
        return not self._thread.is_alive()

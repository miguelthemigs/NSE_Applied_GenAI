import atexit
import os
from pathlib import Path
import signal
import shutil
import subprocess
import time
from typing import Protocol

import requests

from src.config.paths import ROOT_DIR
from src.pipeline import model_downloads
from src.config.settings import (
    DEFAULT_LLM_PROVIDER,
    LLAMA_CPP_API_KEY,
    LLAMA_CPP_BASE_URL,
    LLAMA_CPP_SERVER_BIN,
    LLAMA_CPP_STARTUP_TIMEOUT,
)
from .llama_cpp_models import resolve_llama_cpp_model


class LocalModelConnectionError(RuntimeError):
    pass


def llama_server_env() -> dict[str, str]:
    """The launch env: the same HF cache that snapshot_download writes to.

    llama-server reads both HF_HUB_CACHE and LLAMA_CACHE (Task 12 spike), so
    both point at one directory; never set it for only one of the two.
    """
    cache = model_downloads.hub_cache_dir()
    return {**os.environ, "HF_HUB_CACHE": cache, "LLAMA_CACHE": cache}


class LLMClient(Protocol):
    def ensure_model_available(self, model_name: str, allow_download: bool = False) -> None:
        ...

    def generate_json(
        self, model_name: str, prompt: str, timeout: int | None = None
    ) -> str:
        ...

    def unload(self, model_name: str) -> None:
        ...


class LlamaCppClient:
    base_url = LLAMA_CPP_BASE_URL.rstrip("/")
    _managed_process: subprocess.Popen | None = None
    _managed_log_path = ROOT_DIR / "logs" / "llama-server.log"
    _managed_pid_path = ROOT_DIR / "logs" / "llama-server.pid"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {LLAMA_CPP_API_KEY}",
            "Content-Type": "application/json",
        }

    def _server_command(self, model_name: str) -> list[str]:
        model = resolve_llama_cpp_model(model_name)
        return model.server_command(LLAMA_CPP_SERVER_BIN)

    def _check_llama_server_binary(self, model_name: str) -> None:
        server_bin = self._server_command(model_name)[0]
        if shutil.which(server_bin):
            return
        raise RuntimeError(
            f"Could not find `{server_bin}` on PATH. Install the required llama.cpp "
            "server binary or set its full path in the environment."
        )

    @staticmethod
    def _model_ids(payload: dict) -> set[str]:
        items = payload.get("data") or payload.get("models") or []
        return {
            str(item.get("id") or item.get("model") or item.get("name") or "").strip()
            for item in items
            if isinstance(item, dict)
        } - {""}

    def _single_server_model_ids(self) -> set[str]:
        response = requests.get(f"{self.base_url}/v1/models", timeout=10)
        if response.status_code != 200:
            raise RuntimeError(
                f"llama.cpp /v1/models failed with status {response.status_code}: "
                f"{response.text}"
            )
        return self._model_ids(response.json())

    def _wait_until_server_ready(self, model_name: str) -> None:
        deadline = time.monotonic() + LLAMA_CPP_STARTUP_TIMEOUT
        last_error = ""
        while time.monotonic() < deadline:
            process = self.__class__._managed_process
            if process is not None and process.poll() is not None:
                raise RuntimeError(
                    "llama-server exited before becoming ready. "
                    f"Check {self._managed_log_path} for startup details."
                )
            try:
                response = requests.get(f"{self.base_url}/v1/models", timeout=3)
                if response.status_code == 200:
                    loaded_models = self._model_ids(response.json())
                    if model_name in loaded_models:
                        return
                    last_error = (
                        f"llama-server is ready but loaded {sorted(loaded_models) or ['unknown']} "
                        f"instead of {model_name}"
                    )
                else:
                    last_error = f"HTTP {response.status_code}: {response.text[:300]}"
            except requests.exceptions.RequestException as exc:
                last_error = str(exc)
            time.sleep(1)

        command = " ".join(self._server_command(model_name))
        raise RuntimeError(
            f"Timed out waiting for llama-server after {LLAMA_CPP_STARTUP_TIMEOUT}s. "
            f"Command: `{command}`. Last check: {last_error}. "
            f"Log: {self._managed_log_path}"
        )

    def _start_llama_server(self, model_name: str) -> None:
        process = self.__class__._managed_process
        if process is not None and process.poll() is None:
            self._wait_until_server_ready(model_name)
            return

        self._check_llama_server_binary(model_name)
        # The server runs with --offline and only POST /api/llm-models/start-stream
        # downloads (visibly). Here the files must already be local: a fast, clear
        # ModelNotDownloadedError (error.model_missing) instead of a silent download.
        # The startup timeout below therefore only covers loading.
        model = resolve_llama_cpp_model(model_name)
        model_downloads.require_local(model.repo_id, model.download_patterns)
        self._managed_log_path.parent.mkdir(parents=True, exist_ok=True)
        command = self._server_command(model_name)
        with self._managed_log_path.open("ab") as log_file:
            log_file.write(
                f"\n\n--- Starting {' '.join(command)} at {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n".encode()
            )
            process = subprocess.Popen(
                command,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=llama_server_env(),
            )
        self.__class__._managed_process = process
        self._managed_pid_path.write_text(str(process.pid), encoding="ascii")
        self._wait_until_server_ready(model_name)

    def _restart_llama_server(self, model_name: str) -> None:
        # Check the new model's files BEFORE stopping a healthy server: an uncached
        # model must fail fast without killing the one that is running.
        model = resolve_llama_cpp_model(model_name)
        model_downloads.require_local(model.repo_id, model.download_patterns)
        self.__class__._stop_managed_server()
        try:
            response = requests.get(f"{self.base_url}/v1/models", timeout=2)
        except requests.exceptions.RequestException:
            self._start_llama_server(model_name)
            return
        if response.status_code < 500:
            loaded_models = sorted(self._model_ids(response.json()))
            raise RuntimeError(
                "A llama-server not managed by this app is already running at "
                f"{self.base_url} with model(s): {loaded_models or ['unknown']}. "
                "Stop it before selecting a different model."
            )
        self._start_llama_server(model_name)

    def _model_command_hint(self, model_name: str) -> str:
        model = resolve_llama_cpp_model(model_name)
        return (
            f"Run `{model.download_command}` manually, or enable "
            "`Start llama-server if needed` in the UI."
        )

    def _get_router_models(self) -> list[dict] | None:
        response = requests.get(f"{self.base_url}/models?reload=1", timeout=10)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise RuntimeError(
                f"llama.cpp model check failed with status {response.status_code}: {response.text}"
            )
        return response.json().get("data", [])

    @classmethod
    def running_managed_model_id(cls) -> str | None:
        """Id of the model the running managed llama-server serves, else None."""
        if not cls._has_managed_server():
            return None
        try:
            response = requests.get(f"{cls.base_url}/v1/models", timeout=2)
            if response.status_code != 200:
                return None
            ids = sorted(cls._model_ids(response.json()))
        except Exception:
            return None
        for model_id in ids:
            try:
                return resolve_llama_cpp_model(model_id).id
            except ValueError:
                continue
        return None

    @classmethod
    def _has_managed_server(cls) -> bool:
        process = cls._managed_process
        if process is not None and process.poll() is None:
            return True
        saved_pid = cls._saved_managed_pid()
        if saved_pid is not None and cls._is_saved_llama_server(saved_pid):
            return True
        return bool(cls._configured_server_pids())

    def ensure_model_available(self, model_name: str, allow_download: bool = False) -> None:
        model = resolve_llama_cpp_model(model_name)
        try:
            router_models = self._get_router_models()
        except requests.exceptions.ConnectionError as exc:
            if allow_download:
                self._start_llama_server(model.id)
                return
            raise LocalModelConnectionError(
                f"Could not connect to llama.cpp at {self.base_url}. "
                f"{self._model_command_hint(model.id)}"
            ) from exc
        except requests.exceptions.Timeout as exc:
            raise RuntimeError("llama.cpp did not respond while checking models.") from exc

        if router_models is None:
            try:
                loaded_models = self._single_server_model_ids()
            except requests.exceptions.ConnectionError as exc:
                if allow_download:
                    self._start_llama_server(model.id)
                    return
                raise LocalModelConnectionError(
                    f"Could not connect to llama.cpp at {self.base_url}. "
                    "Start `llama-server` before generating insights."
                ) from exc
            if model.id in loaded_models:
                return
            if allow_download:
                self._restart_llama_server(model.id)
                return
            raise RuntimeError(
                f"llama.cpp loaded {sorted(loaded_models) or ['unknown']}, "
                f"not the selected model '{model.id}'."
            )

        available = {
            str(item.get("id") or item.get("model") or "").strip(): item
            for item in router_models
        }
        if model.id in available:
            status = available[model.id].get("status") or {}
            if status.get("failed"):
                raise RuntimeError(
                    f"llama.cpp failed to load '{model.id}'. "
                    f"Status: {status}. {self._model_command_hint(model.id)}"
                )
            return

        if allow_download and self._has_managed_server():
            self._restart_llama_server(model.id)
            return

        installed = ", ".join(sorted(available)) or "none"
        raise RuntimeError(
            f"llama.cpp model '{model.id}' is not available to the router. "
            f"Available models: {installed}. {self._model_command_hint(model.id)}"
        )

    def generate_json(
        self, model_name: str, prompt: str, timeout: int | None = None
    ) -> str:
        model = resolve_llama_cpp_model(model_name)
        try:
            response = requests.post(
                f"{self.base_url}/v1/chat/completions",
                headers=self._headers(),
                json=model.chat_completion_payload(prompt),
                timeout=timeout,
            )
        except requests.exceptions.ConnectionError as exc:
            raise LocalModelConnectionError(
                f"Could not connect to llama.cpp at {self.base_url}. "
                f"Ensure `llama-server` is running with model '{model.id}'."
            ) from exc

        if response.status_code != 200:
            raise RuntimeError(
                f"llama.cpp returned status {response.status_code}: {response.text}"
            )
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            return "{}"
        choice = choices[0]
        finish_reason = choice.get("finish_reason") or ""
        if finish_reason == "length":
            print(
                f"[LLM] Warning: model '{model_name}' hit max_tokens limit "
                f"(finish_reason=length). Output may be truncated."
            )
        message = choice.get("message") or {}
        return message.get("content") or "{}"

    def unload(self, model_name: str) -> None:
        try:
            model = resolve_llama_cpp_model(model_name)
            requests.post(
                f"{self.base_url}/models/unload",
                headers=self._headers(),
                json={"model": model.id},
                timeout=10,
            )
        except Exception:
            pass

    @classmethod
    def _saved_managed_pid(cls) -> int | None:
        try:
            return int(cls._managed_pid_path.read_text(encoding="ascii").strip())
        except (FileNotFoundError, OSError, ValueError):
            return None

    @classmethod
    def _is_saved_llama_server(cls, pid: int) -> bool:
        command = cls._pid_command(pid)
        if not command:
            return False
        configured_binaries = {str(Path(LLAMA_CPP_SERVER_BIN).expanduser())}
        return (
            any(binary in command for binary in configured_binaries)
            or "llama-server" in command
        )

    @classmethod
    def _pid_command(cls, pid: int) -> str:
        cmdline_path = Path(f"/proc/{pid}/cmdline")
        try:
            return cmdline_path.read_bytes().replace(b"\0", b" ").decode(
                errors="replace"
            )
        except OSError:
            pass
        try:
            return subprocess.check_output(
                ["ps", "-p", str(pid), "-o", "command="],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=2,
            ).strip()
        except (OSError, subprocess.SubprocessError):
            return ""

    @classmethod
    def _configured_server_pids(cls) -> list[int]:
        proc_root = Path("/proc")
        configured_binary = str(Path(LLAMA_CPP_SERVER_BIN).expanduser().resolve())
        matches = []
        if not proc_root.is_dir():
            try:
                pids = subprocess.check_output(
                    ["pgrep", "-f", "llama.*server"],
                    text=True,
                    stderr=subprocess.DEVNULL,
                    timeout=2,
                )
            except (OSError, subprocess.SubprocessError):
                return []
            for line in pids.splitlines():
                try:
                    pid = int(line.strip())
                except ValueError:
                    continue
                if cls._is_saved_llama_server(pid):
                    matches.append(pid)
            return matches

        for entry in proc_root.iterdir():
            if not entry.name.isdigit():
                continue
            command = cls._pid_command(int(entry.name)).split(" ", 1)[0]
            if command and str(Path(command).expanduser().resolve()) == configured_binary:
                matches.append(int(entry.name))
        return matches

    @classmethod
    def _terminate_saved_process(cls, pid: int) -> None:
        if not cls._is_saved_llama_server(pid):
            return
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        for _ in range(100):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.1)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    @classmethod
    def _stop_managed_server(cls) -> None:
        process = cls._managed_process
        saved_pid = cls._saved_managed_pid()
        stopped_pid = None
        if process is not None:
            stopped_pid = process.pid
            if process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
                except Exception:
                    pass
        elif saved_pid is not None:
            stopped_pid = saved_pid
            cls._terminate_saved_process(saved_pid)
        else:
            configured_pids = cls._configured_server_pids()
            if len(configured_pids) == 1:
                stopped_pid = configured_pids[0]
                cls._terminate_saved_process(stopped_pid)
        cls._managed_process = None
        if saved_pid == stopped_pid:
            try:
                cls._managed_pid_path.unlink()
            except FileNotFoundError:
                pass


atexit.register(LlamaCppClient._stop_managed_server)


def get_llm_client(provider: str = DEFAULT_LLM_PROVIDER) -> LLMClient:
    selected = (provider or DEFAULT_LLM_PROVIDER).strip().lower()
    if selected in {"llama.cpp", "llamacpp", "llama-cpp"}:
        return LlamaCppClient()
    raise ValueError(f"Unsupported LLM provider: {provider}")

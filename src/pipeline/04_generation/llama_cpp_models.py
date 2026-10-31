from dataclasses import dataclass
from typing import Any

import os

from src.config.settings import LLAMA_CPP_N_GPU_LAYERS

DEFAULT_QUANTIZATION = "UD-Q4_K_XL"
DEFAULT_SERVER_ARGS = ("--skip-chat-parsing",)
# Only POST /api/llm-models/start-stream downloads (visibly); the server never
# does: a missing file fails fast instead of a silent re-download.
OFFLINE_SERVER_ARGS = ("--offline",)


@dataclass(frozen=True)
class LlamaCppGenerationSettings:
    context_size: int = 8192
    max_tokens: int = 8192
    temperature: float = 0.1
    top_k: int | None = 40
    top_p: float | None = None
    min_p: float | None = None
    repeat_penalty: float | None = None
    enable_thinking: bool = False
    json_mode: bool = False

    @property
    def server_args(self) -> list[str]:
        args: list[str] = []
        env_ctx = os.environ.get("LLAMA_ARG_CTX_SIZE")
        ctx = int(env_ctx) if env_ctx and env_ctx.strip().isdigit() else self.context_size
        if ctx > 0:
            args.extend(["-c", str(ctx)])
        if LLAMA_CPP_N_GPU_LAYERS in {"auto", "all"}:
            args.extend(["-ngl", LLAMA_CPP_N_GPU_LAYERS])
        else:
            try:
                gpu_layers = int(LLAMA_CPP_N_GPU_LAYERS)
            except ValueError as exc:
                raise ValueError(
                    "LLAMA_CPP_N_GPU_LAYERS must be 'auto', 'all', or a non-negative integer."
                ) from exc
            if gpu_layers < 0:
                raise ValueError(
                    "LLAMA_CPP_N_GPU_LAYERS must be 'auto', 'all', or a non-negative integer."
                )
            args.extend(["-ngl", str(gpu_layers)])
        return args

    def chat_completion_payload(self, model_id: str, prompt: str) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": model_id,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "max_tokens": self.max_tokens,
            "chat_template_kwargs": {"enable_thinking": self.enable_thinking},
            "temperature": self.temperature,
        }
        if self.top_k is not None:
            payload["top_k"] = self.top_k
        if self.top_p is not None:
            payload["top_p"] = self.top_p
        if self.min_p is not None:
            payload["min_p"] = self.min_p
        if self.repeat_penalty is not None:
            payload["repeat_penalty"] = self.repeat_penalty
        if self.json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    def to_dict(self) -> dict[str, Any]:
        return {
            "context_size": self.context_size,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "top_k": self.top_k,
            "top_p": self.top_p,
            "min_p": self.min_p,
            "repeat_penalty": self.repeat_penalty,
            "enable_thinking": self.enable_thinking,
            "json_mode": self.json_mode,
        }


@dataclass(frozen=True)
class LlamaCppModel:
    id: str
    name: str
    repo_id: str
    filename: str
    quantization: str = DEFAULT_QUANTIZATION
    size: str = ""
    speed: str = ""
    recommended: bool = False
    generation: LlamaCppGenerationSettings = LlamaCppGenerationSettings()
    extra_server_args: tuple[str, ...] = ()

    @property
    def llama_server_model_id(self) -> str:
        return f"{self.repo_id}:{self.quantization}"

    @property
    def download_patterns(self) -> list[str]:
        """The repo files `llama-server -hf <repo>:<quant>` loads: the main GGUF,
        the BF16 projector and the root-level MTP draft. Narrower than
        `mmproj*` / `*mtp*`, which would also pull the F16/F32 projectors and
        the MTP/ variants (about 2.8 GB extra for 12B)."""
        return [f"*{self.quantization}*.gguf", "mmproj-BF16.gguf", "mtp-*.gguf"]

    @property
    def download_command(self) -> str:
        return " ".join(
            [
                "llama-server",
                "-hf",
                self.llama_server_model_id,
                *self.generation.server_args,
                *DEFAULT_SERVER_ARGS,
                *self.extra_server_args,
            ]
        )

    def server_command(self, server_bin: str) -> list[str]:
        return [
            server_bin,
            "-hf",
            self.llama_server_model_id,
            *OFFLINE_SERVER_ARGS,
            *self.generation.server_args,
            *DEFAULT_SERVER_ARGS,
            *self.extra_server_args,
        ]

    def chat_completion_payload(self, prompt: str) -> dict[str, Any]:
        return self.generation.chat_completion_payload(self.id, prompt)


GEMMA_LLAMA_CPP_MODELS = (
    LlamaCppModel(
        id="unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL",
        name="Gemma 4 E2B IT QAT UD-Q4_K_XL",
        repo_id="unsloth/gemma-4-E2B-it-qat-GGUF",
        filename="gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf",
        size="2.62 GB",
        speed="Very fast",
        extra_server_args=(
            "--spec-type",
            "draft-mtp",
            "--spec-draft-n-max",
            "2",
        ),
        generation=LlamaCppGenerationSettings(
            context_size=127000,
            max_tokens=12768,
            temperature=1.0,
            top_p=0.95,
            top_k=64,
            enable_thinking=True,
        ),
    ),
    LlamaCppModel(
        id="unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL",
        name="Gemma 4 E4B IT QAT UD-Q4_K_XL",
        repo_id="unsloth/gemma-4-E4B-it-qat-GGUF",
        filename="gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf",
        size="4.22 GB",
        speed="Fast",
        extra_server_args=(
            "--spec-type",
            "draft-mtp",
            "--spec-draft-n-max",
            "2",
        ),
        generation=LlamaCppGenerationSettings(
            context_size=127000,
            max_tokens=18768,
            temperature=1.0,
            top_p=0.95,
            top_k=64,
            enable_thinking=True,
        ),
    ),
    LlamaCppModel(
        id="unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL",
        name="Gemma 4 12B IT QAT UD-Q4_K_XL",
        repo_id="unsloth/gemma-4-12B-it-qat-GGUF",
        filename="gemma-4-12B-it-qat-UD-Q4_K_XL.gguf",
        size="6.2 GB",
        speed="Moderate",
        extra_server_args=(
            "--spec-type",
            "draft-mtp",
            "--spec-draft-n-max",
            "2",
        ),
        recommended=True,
        generation=LlamaCppGenerationSettings(
            context_size=127000,
            max_tokens=18192,
            temperature=1.0,
            top_p=0.95,
            top_k=64,
            enable_thinking=True,
        ),
    ),
    LlamaCppModel(
        id="unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL",
        name="Gemma 4 26B A4B IT QAT UD-Q4_K_XL",
        repo_id="unsloth/gemma-4-26B-A4B-it-qat-GGUF",
        filename="gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf",
        size="~16.9 GB",
        speed="Moderate",
        extra_server_args=(
            "--spec-type",
            "draft-mtp",
            "--spec-draft-n-max",
            "2",
        ),
        generation=LlamaCppGenerationSettings(
            context_size=127000,
            max_tokens=18192,
            temperature=1.0,
            top_p=0.95,
            top_k=64,
            enable_thinking=True,
        ),
    ),
    LlamaCppModel(
        id="unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL",
        name="Gemma 4 31B IT QAT UD-Q4_K_XL",
        repo_id="unsloth/gemma-4-31B-it-qat-GGUF",
        filename="gemma-4-31B-it-qat-UD-Q4_K_XL.gguf",
        size="18.8 GB",
        speed="Slow",
        extra_server_args=(
            "--spec-type",
            "draft-mtp",
            "--spec-draft-n-max",
            "2",
        ),
        generation=LlamaCppGenerationSettings(
            context_size=128000,
            max_tokens=18192,
            temperature=1.0,
            top_p=0.95,
            top_k=64,
            enable_thinking=True,
        ),
    ),
)

LLAMA_CPP_MODEL_REGISTRY = {model.id: model for model in GEMMA_LLAMA_CPP_MODELS}

LLAMA_CPP_MODEL_ALIASES = {
    "gemma4:e2b": "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL",
    "gemma4:e4b": "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL",
    "gemma4:12b": "unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL",
    "gemma4:26b": "unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL",
    "gemma4:31b": "unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL": "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M": "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL": "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-E4B-it-GGUF:Q4_K_M": "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-12B-it-GGUF:UD-Q4_K_XL": "unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-12B-it-GGUF:Q4_K_M": "unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_M": "unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q4_K_XL": "unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-26B-A4B-it-GGUF:Q4_K_M": "unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-31B-it-GGUF:UD-Q4_K_XL": "unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL",
    "unsloth/gemma-4-31B-it-GGUF:Q4_K_M": "unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL",
}


def resolve_llama_cpp_model(model_name: str) -> LlamaCppModel:
    selected = (model_name or "").strip()
    selected = LLAMA_CPP_MODEL_ALIASES.get(selected, selected)
    if selected in LLAMA_CPP_MODEL_REGISTRY:
        return LLAMA_CPP_MODEL_REGISTRY[selected]
    raise ValueError(
        f"Unsupported llama.cpp model '{model_name}'. "
        f"Choose one of: {', '.join(LLAMA_CPP_MODEL_REGISTRY)}."
    )


def llama_cpp_model_options() -> list[dict]:
    return [
        {
            "id": model.id,
            "name": model.name,
            "repo_id": model.repo_id,
            "filename": model.filename,
            "quantization": model.quantization,
            "size": model.size,
            "speed": model.speed,
            "recommended": model.recommended,
            "llama_server_model_id": model.llama_server_model_id,
            "download_command": model.download_command,
            "extra_server_args": list(model.extra_server_args),
            "generation": model.generation.to_dict(),
        }
        for model in GEMMA_LLAMA_CPP_MODELS
    ]

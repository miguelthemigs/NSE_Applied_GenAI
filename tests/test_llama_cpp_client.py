from __future__ import annotations

from importlib import import_module
import unittest
from unittest import mock


llm_clients = import_module("src.pipeline.04_generation.llm_clients")
llama_cpp_models = import_module("src.pipeline.04_generation.llama_cpp_models")

E2B_MODEL = "unsloth/gemma-4-E2B-it-qat-GGUF:UD-Q4_K_XL"
LEGACY_E2B_MODEL = "unsloth/gemma-4-E2B-it-GGUF:UD-Q4_K_XL"
E4B_MODEL = "unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL"
LEGACY_E4B_MODEL = "unsloth/gemma-4-E4B-it-GGUF:UD-Q4_K_XL"
MODEL_12B = "unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL"
MODEL_26B = "unsloth/gemma-4-26B-A4B-it-qat-GGUF:UD-Q4_K_XL"
MODEL_31B = "unsloth/gemma-4-31B-it-qat-GGUF:UD-Q4_K_XL"


class LlamaCppClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = llm_clients.LlamaCppClient()

    def test_model_ids_supports_openai_and_models_payloads(self) -> None:
        self.assertEqual(
            self.client._model_ids({"data": [{"id": E4B_MODEL}]}),
            {E4B_MODEL},
        )
        self.assertEqual(
            self.client._model_ids({"models": [{"model": E2B_MODEL}]}),
            {E2B_MODEL},
        )

    def test_legacy_e2b_id_resolves_to_qat_model(self) -> None:
        self.assertEqual(
            llama_cpp_models.resolve_llama_cpp_model(LEGACY_E2B_MODEL).id,
            E2B_MODEL,
        )

    def test_legacy_e4b_id_resolves_to_qat_model(self) -> None:
        self.assertEqual(
            llama_cpp_models.resolve_llama_cpp_model(LEGACY_E4B_MODEL).id,
            E4B_MODEL,
        )

    def test_server_command_enables_mtp_for_qat_mtp_models(self) -> None:
        expected_draft_n = {
            E2B_MODEL: "2",
            E4B_MODEL: "2",
            MODEL_12B: "2",
            MODEL_26B: "2",
            MODEL_31B: "2",
        }
        for model_id, draft_n in expected_draft_n.items():
            with self.subTest(model_id=model_id):
                command = llama_cpp_models.resolve_llama_cpp_model(
                    model_id
                ).server_command("llama-server")

                self.assertEqual(
                    command[-4:],
                    ["--spec-type", "draft-mtp", "--spec-draft-n-max", draft_n],
                )

    def test_matching_single_server_model_is_reused(self) -> None:
        with (
            mock.patch.object(self.client, "_get_router_models", return_value=None),
            mock.patch.object(
                self.client, "_single_server_model_ids", return_value={E4B_MODEL}
            ),
            mock.patch.object(self.client, "_restart_llama_server") as restart,
        ):
            self.client.ensure_model_available(E4B_MODEL, allow_download=True)

        restart.assert_not_called()

    def test_different_single_server_model_is_restarted(self) -> None:
        with (
            mock.patch.object(self.client, "_get_router_models", return_value=None),
            mock.patch.object(
                self.client, "_single_server_model_ids", return_value={E4B_MODEL}
            ),
            mock.patch.object(self.client, "_restart_llama_server") as restart,
        ):
            self.client.ensure_model_available(E2B_MODEL, allow_download=True)

        restart.assert_called_once_with(E2B_MODEL)

    def test_different_single_server_model_errors_without_autostart(self) -> None:
        with (
            mock.patch.object(self.client, "_get_router_models", return_value=None),
            mock.patch.object(
                self.client, "_single_server_model_ids", return_value={E4B_MODEL}
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "not the selected model"):
                self.client.ensure_model_available(E2B_MODEL, allow_download=False)

    def test_models_endpoint_switches_an_app_managed_single_server(self) -> None:
        with (
            mock.patch.object(
                self.client,
                "_get_router_models",
                return_value=[{"id": E4B_MODEL}],
            ),
            mock.patch.object(self.client, "_has_managed_server", return_value=True),
            mock.patch.object(self.client, "_restart_llama_server") as restart,
        ):
            self.client.ensure_model_available(E2B_MODEL, allow_download=True)

        restart.assert_called_once_with(E2B_MODEL)

    def test_orphaned_configured_server_is_recovered_after_flask_restart(self) -> None:
        with (
            mock.patch.object(llm_clients.LlamaCppClient, "_managed_process", None),
            mock.patch.object(
                llm_clients.LlamaCppClient, "_saved_managed_pid", return_value=None
            ),
            mock.patch.object(
                llm_clients.LlamaCppClient,
                "_configured_server_pids",
                return_value=[1234],
            ),
        ):
            self.assertTrue(self.client._has_managed_server())

    def test_configured_server_pids_falls_back_to_pgrep_without_proc(self) -> None:
        def fake_check_output(command, **_kwargs):
            if command[:2] == ["pgrep", "-f"]:
                return "1234\n"
            if command[:3] == ["ps", "-p", "1234"]:
                return "/usr/local/bin/llama-server -hf test-model\n"
            return ""

        with (
            mock.patch.object(llm_clients.Path, "is_dir", return_value=False),
            mock.patch.object(
                llm_clients.subprocess,
                "check_output",
                side_effect=fake_check_output,
            ),
        ):
            self.assertEqual(llm_clients.LlamaCppClient._configured_server_pids(), [1234])

    def test_generate_json_has_no_read_timeout_by_default(self) -> None:
        response = mock.Mock()
        response.status_code = 200
        response.json.return_value = {
            "choices": [
                {
                    "message": {"content": '{"ok": true}'},
                    "finish_reason": "stop",
                }
            ]
        }

        with mock.patch.object(llm_clients.requests, "post", return_value=response) as post:
            self.assertEqual(
                self.client.generate_json(E4B_MODEL, "Generate JSON."),
                '{"ok": true}',
            )

        self.assertIsNone(post.call_args.kwargs["timeout"])


if __name__ == "__main__":
    unittest.main()

"""Import first in every test module that loads the llama.cpp client.

The client registers an atexit hook that stops the managed llama-server and
deletes logs/llama-server.pid. A test run must never stop the user's running
server or touch that file, so the hook is unregistered for the test process.
"""
import atexit
from importlib import import_module

_llm_clients = import_module("src.pipeline.04_generation.llm_clients")
atexit.unregister(_llm_clients.LlamaCppClient._stop_managed_server)

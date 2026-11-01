from importlib import import_module

from flask import Blueprint, Response, jsonify, request

from src.api.guards import busy_response
from src.pipeline import jobs

anonymize_bp = Blueprint("anonymize", __name__)
service = import_module("src.pipeline.01_anonymization.service")
_blocklist_mod = import_module("src.pipeline.01_anonymization.blocklist")


@anonymize_bp.route("/api/inspect-file", methods=["POST"])
def inspect_file():
    try:
        return jsonify(service.inspect_uploaded_file(request.files.get("file")))
    except ValueError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


@anonymize_bp.route("/api/anonymize", methods=["POST"])
def anonymize():
    try:
        data = request.get_json(silent=True) or {}
        stream = service.anonymize_uploaded_file(
            data.get("selected_columns", []),
            data.get("selected_layers", ["presidio", "eu-pii"]),
            data.get("run_verification", True),
        )
        return Response(stream, mimetype="application/x-ndjson")
    except jobs.JobBusy as exc:
        return busy_response(exc)
    except FileNotFoundError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        print(f"[ANONYMIZE ERROR] {str(exc)}")
        return jsonify({"status": "error", "error": str(exc)}), 500


@anonymize_bp.route("/api/inspect-anonymized", methods=["GET"])
def inspect_anonymized():
    try:
        return jsonify(service.inspect_anonymized_file())
    except FileNotFoundError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


@anonymize_bp.route("/api/run-anonymize-check", methods=["POST"])
def run_anonymize_check():
    try:
        return Response(
            service.run_anonymize_check_stream(),
            mimetype="application/x-ndjson",
        )
    except jobs.JobBusy as exc:
        return busy_response(exc)
    except FileNotFoundError as exc:
        return jsonify({"status": "error", "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


@anonymize_bp.route("/api/anonymize-report", methods=["GET"])
def anonymize_report():
    return jsonify(service.anonymize_report_payload())


@anonymize_bp.route("/api/checkpoint-status", methods=["GET"])
def checkpoint_status():
    return jsonify(service.checkpoint_status_payload())


@anonymize_bp.route("/api/word-blocklist", methods=["GET"])
def get_word_blocklist():
    return jsonify({"words": _blocklist_mod.load_blocklist()})


@anonymize_bp.route("/api/word-blocklist", methods=["POST"])
def set_word_blocklist():
    data = request.get_json(silent=True) or {}
    words = [w for w in data.get("words", []) if isinstance(w, str) and w.strip()]
    _blocklist_mod.save_blocklist(words)
    return jsonify({"words": _blocklist_mod.load_blocklist()})

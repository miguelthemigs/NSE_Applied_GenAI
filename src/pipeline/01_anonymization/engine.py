import json

from src.pipeline.events import stream_event
import logging
import os
import re
from pathlib import Path

import pandas as pd

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

from src.utils.model_device import describe_model_device, get_model_device
from .layers.privacy_pipeline import process_chunk_sync, validate_selected_layers
from src.config.paths import (
    ANON_CHECKPOINT_CSV,
    ANON_CHECKPOINT_META,
    ANON_REPORT_FILE,
    ANON_REPORT_JSON,
)
from . import checkpoints, reporting
from .blocklist import apply_blocklist, load_blocklist
from src.utils.file_parsers import detect_sep, read_dataframe

os.environ["TOKENIZERS_PARALLELISM"] = "false"
logger = logging.getLogger(__name__)

# Chunk size for span collection + masking (Layer 2 HF batching).
# Default 512 for betere throughput; override via ANONYMIZE_BATCH_SIZE indien nodig.
_ANON_BATCH = int(os.environ.get("ANONYMIZE_BATCH_SIZE", "512"))

CHECKPOINT_CSV = ANON_CHECKPOINT_CSV
CHECKPOINT_META = ANON_CHECKPOINT_META
REPORT_FILE = ANON_REPORT_FILE
REPORT_JSON = ANON_REPORT_JSON

_write_report = reporting.write_report
_load_checkpoint = checkpoints.load_checkpoint
_save_checkpoint = checkpoints.save_checkpoint
_clear_checkpoint = checkpoints.clear_checkpoint


def _read_input(path: str, sep: str = None) -> "pd.DataFrame":
    if Path(path).suffix.lower() in (".xlsx", ".xls"):
        return read_dataframe(path)
    return read_dataframe(path, sep=sep or detect_sep(path))


def process_file_with_layers(
    input_path: str,
    output_path: str,
    columns_to_anonymize: list,
    layers: list,
    sep: str = None,
    run_verification: bool = True,
):
    is_xlsx = Path(input_path).suffix.lower() in (".xlsx", ".xls")
    if not is_xlsx and sep is None:
        sep = detect_sep(input_path)

    # Always read original texts from source for end-of-run verification.
    df_original = _read_input(input_path, sep)
    original_texts = {
        col: df_original[col].copy()
        for col in columns_to_anonymize
        if col in df_original.columns
    }

    # Check for a resumable checkpoint.
    checkpoint_df, checkpoint_meta = _load_checkpoint(input_path, sep)
    if checkpoint_df is not None:
        df = checkpoint_df
        completed_columns = set(checkpoint_meta.get("completed_columns", []))
        checkpoint_col = checkpoint_meta.get("current_col")
        checkpoint_batch_end = checkpoint_meta.get("current_batch_end", 0)
        yield (
            stream_event("progress", stage="read", message=f"Resuming from checkpoint ({len(completed_columns)} column(s) already done)...", progress=5)
        )
    else:
        df = df_original.copy()
        completed_columns = set()
        checkpoint_col = None
        checkpoint_batch_end = 0
        yield (
            stream_event("progress", stage="read", message="Initializing...", progress=5)
        )

    stat = os.stat(input_path)
    meta = {
        "input_size": stat.st_size,
        "input_mtime": stat.st_mtime,
        "sep": sep,
        "selected_columns": columns_to_anonymize,
        "selected_layers": layers,
        "run_verification": run_verification,
        "completed_columns": list(completed_columns),
    }

    # Save immediately so a resume banner appears even if the very first batch crashes.
    if checkpoint_df is None:
        _save_checkpoint(df, meta, sep)

    try:
        validate_selected_layers(layers)
    except Exception as e:
        yield (
            stream_event("error", code="error.model_missing", message="Model preflight failed before anonymization started.", progress=0, error=str(e))
        )
        return

    # Layer config toggles (mirrors the other project’s intent)
    layer_config = {"names": True, "locations": True, "pii": True, "titles": True}

    if "presidio" in layers:
        yield (
            stream_event("progress", stage="load", message="Loading Layer 1 (Presidio)...", progress=10)
        )
    if "eu-pii" in layers:
        device_label = describe_model_device(get_model_device())
        yield (
            stream_event("progress", stage="load", message=f"Loading Layer 2 (EU-PII-Safeguard) on {device_label}...", progress=20)
        )
    if "openai-privacy-filter" in layers:
        device_label = describe_model_device(get_model_device())
        yield (
            stream_event("progress", stage="load", message=f"Loading Layer 2 (OpenAI Privacy Filter) on {device_label}...", progress=20)
        )

    # Load custom word blocklist once — applied after every batch as a fast
    # post-processing step that doesn't touch any NER model.
    _blocklist = load_blocklist()
    if _blocklist:
        logger.info("Custom word blocklist loaded: %d entr%s", len(_blocklist), "y" if len(_blocklist) == 1 else "ies")

    total_cols = len(columns_to_anonymize)
    total_rows = len(df)

    for col_idx, col in enumerate(columns_to_anonymize):
        if col not in df.columns:
            yield (
                stream_event("progress", stage="process", message=f"Column ‘{col}’ not found.", progress=20)
            )
            continue

        if col in completed_columns:
            yield (
                stream_event("progress", stage="process", message=f"Skipping ‘{col}’ (already done in checkpoint).", progress=20 + int(70 * ((col_idx + 1) / total_cols)))
            )
            continue

        yield (
            stream_event("progress", stage="process", message=f"Anonymizing column: {col}...", progress=20 + int(70 * (col_idx / total_cols)))
        )

        # How far we already got in this column (0 = fresh start).
        resume_batch_end = checkpoint_batch_end if col == checkpoint_col else 0

        col_series = df[col]
        batch_starts = list(range(0, total_rows, _ANON_BATCH))
        for batch_start in batch_starts:
            batch_end = min(batch_start + _ANON_BATCH, total_rows)

            if batch_end <= resume_batch_end:
                # Already saved in checkpoint — skip without reprocessing.
                continue

            chunk_texts = []
            chunk_indices = []
            for i in range(batch_start, batch_end):
                text = col_series.at[i]
                if pd.isna(text) or not isinstance(text, str) or not text.strip():
                    continue
                chunk_texts.append(text)
                chunk_indices.append(i)

            if chunk_texts:
                masked = process_chunk_sync(chunk_texts, layer_config, layers)
                if _blocklist:
                    masked = [apply_blocklist(t, _blocklist) for t in masked]
                for row_i, new_val in zip(chunk_indices, masked):
                    df.at[row_i, col] = new_val

            # Checkpoint after every batch.
            meta["current_col"] = col
            meta["current_batch_end"] = batch_end
            _save_checkpoint(df, meta, sep)

            last_i = batch_end
            base_progress = 20 + int(70 * (col_idx / total_cols))
            row_progress = int((70 / total_cols) * (last_i / total_rows))
            preview_row = last_i - 1 if last_i else 0
            pv = col_series.at[preview_row] if preview_row >= 0 else ""
            yield (
                stream_event("progress", stage="process", message=f"Processing rows 1–{last_i}/{total_rows} in {col} (batch {_ANON_BATCH})", progress=base_progress + row_progress, column=col, row=last_i, total_rows=total_rows, checkpoint_saved=True, preview=(str(pv)[:60] + "...")
                        if isinstance(pv, str) and pv
                        else "")
            )

        # Column done — update completed list and remove in-progress markers.
        completed_columns.add(col)
        meta["completed_columns"] = list(completed_columns)
        meta.pop("current_col", None)
        meta.pop("current_batch_end", None)
        _save_checkpoint(df, meta, sep)

    # --- Count what was masked (tags inserted into output) ---
    _TAG_RE = re.compile(r'\[(NAME|PII|LOCATION|TITLE|HEALTH)\]')
    total_cells = 0
    affected_cells = 0
    total_entities = 0
    tag_counts = {"NAME": 0, "PII": 0, "LOCATION": 0, "TITLE": 0, "HEALTH": 0}

    for col in columns_to_anonymize:
        if col in df.columns:
            for val in df[col]:
                if pd.isna(val) or not isinstance(val, str) or not val.strip():
                    continue
                total_cells += 1
                matches = _TAG_RE.findall(val)
                if matches:
                    affected_cells += 1
                    total_entities += len(matches)
                    for tag in matches:
                        tag_counts[tag] += 1

    df.to_csv(output_path, sep=sep, index=False)

    if not run_verification:
        missed_counts = {"NAME": 0, "PII": 0, "LOCATION": 0, "TITLE": 0, "HEALTH": 0}
        missed_samples = {"NAME": [], "PII": [], "LOCATION": [], "TITLE": [], "HEALTH": []}
        removed_samples = {"NAME": [], "PII": [], "LOCATION": [], "TITLE": [], "HEALTH": []}

        _write_report(
            input_path=input_path,
            output_path=output_path,
            columns=columns_to_anonymize,
            layers=layers,
            total_rows=total_rows,
            total_cells=total_cells,
            affected_cells=affected_cells,
            total_entities=total_entities,
            tag_counts=tag_counts,
            missed_counts=missed_counts,
            missed_samples=missed_samples,
            removed_samples=removed_samples,
            verification_skipped=True,
        )
        from .layers.privacy_pipeline import unload_all_layer_models
        unload_all_layer_models(layers)
        _clear_checkpoint()

        yield (
            stream_event("success", message="Anonymization complete", progress=100, rows_processed=total_rows, columns_anonymized=columns_to_anonymize, verification_skipped=True, stats={
                        "total_cells": total_cells,
                        "affected_cells": affected_cells,
                        "total_entities": total_entities,
                        "tag_counts": tag_counts,
                        "missed_counts": missed_counts,
                        "missed_samples": missed_samples,
                        "removed_samples": removed_samples,
                        "verification_skipped": True,
                    })
        )
        return

    # --- Verification: detect entities in ORIGINAL text, check if they survived in output ---
    yield (
        stream_event("progress", stage="process", message="Verifying output...", progress=98)
    )

    from .layers.layer1_presidio import collect_presidio_spans
    from .layers.privacy_pipeline import _filter_spans, unload_all_layer_models
    try:
        from .layers.layer2_eu_pii import eu_pii_collect_batch, ensure_eu_pii_available
        ensure_eu_pii_available()
        _eu_pii_ok = True
    except Exception as e:
        logger.info("EU-PII unavailable for verification (%s) — HEALTH samples will be empty.", e)
        _eu_pii_ok = False

    layer_config = {"names": True, "locations": True, "pii": True, "titles": True}
    missed_counts = {"NAME": 0, "PII": 0, "LOCATION": 0, "TITLE": 0, "HEALTH": 0}
    missed_samples = {"NAME": [], "PII": [], "LOCATION": [], "TITLE": [], "HEALTH": []}
    removed_samples = {"NAME": [], "PII": [], "LOCATION": [], "TITLE": [], "HEALTH": []}

    for col in columns_to_anonymize:
        if col not in df.columns:
            continue

        # Batch EU-PII spans for the whole column at once (transformer hates row-by-row)
        col_eu_spans_by_idx: dict[int, list] = {}
        if _eu_pii_ok and col in original_texts:
            col_indices: list[int] = []
            col_texts: list[str] = []
            for idx in range(len(df)):
                ov = original_texts[col].iloc[idx]
                if isinstance(ov, str) and ov.strip():
                    col_indices.append(idx)
                    col_texts.append(ov)
            if col_texts:
                try:
                    batched = eu_pii_collect_batch(col_texts, layer_config)
                    col_eu_spans_by_idx = dict(zip(col_indices, batched))
                except Exception as e:
                    logger.warning("EU-PII verification batch failed for column '%s': %s", col, e)

        for idx in range(len(df)):
            original_val = original_texts.get(col, pd.Series(dtype=str)).iloc[idx] if col in original_texts else None
            anonymized_val = df[col].iloc[idx]

            if pd.isna(original_val) or not isinstance(original_val, str) or not original_val.strip():
                continue

            # Combine Presidio + EU-PII spans so HEALTH (and other layer-2-only entities) are attributed.
            raw_spans = collect_presidio_spans(original_val, layer_config)
            raw_spans = list(raw_spans) + list(col_eu_spans_by_idx.get(idx, []))
            filtered_spans = _filter_spans(original_val, raw_spans, layer_config)
            for start, end, tag in filtered_spans:
                key = tag.strip("[]")
                if key not in missed_counts:
                    continue
                entity_text = original_val[start:end]
                # Skip subword/fragment artifacts emitted by HF tokenizers
                # (e.g. "HD" from "ADHD", "stoor" from "stoornis").
                if len(entity_text.strip()) < 3:
                    continue
                # Word-boundary match avoids substring false positives like
                # "burn" being found inside "[HEALTH] burn-out".
                survived = isinstance(anonymized_val, str) and bool(
                    re.search(rf"\b{re.escape(entity_text)}\b", anonymized_val, re.IGNORECASE)
                )
                if survived:
                    missed_counts[key] += 1
                    if entity_text not in missed_samples[key]:
                        missed_samples[key].append(entity_text)
                else:
                    if entity_text not in removed_samples[key]:
                        removed_samples[key].append(entity_text)

    _write_report(
        input_path=input_path,
        output_path=output_path,
        columns=columns_to_anonymize,
        layers=layers,
        total_rows=total_rows,
        total_cells=total_cells,
        affected_cells=affected_cells,
        total_entities=total_entities,
        tag_counts=tag_counts,
        missed_counts=missed_counts,
        missed_samples=missed_samples,
        removed_samples=removed_samples,
    )
    unload_all_layer_models(layers)
    _clear_checkpoint()

    yield (
        stream_event("success", message="Anonymization complete", progress=100, rows_processed=total_rows, columns_anonymized=columns_to_anonymize, stats={
                    "total_cells": total_cells,
                    "affected_cells": affected_cells,
                    "total_entities": total_entities,
                    "tag_counts": tag_counts,
                    "missed_counts": missed_counts,
                    "missed_samples": missed_samples,
                    "removed_samples": removed_samples,
                })
    )


def run_check_stream(original_path: str, anonymized_path: str, columns: list, sep: str = None, sample_rows: int = None):
    """
    Run only the verification step on already-existing original + anonymized files.
    Yields NDJSON progress events; final event has status='success' with full stats.
    """
    from .layers.layer1_presidio import collect_presidio_spans
    from .layers.privacy_pipeline import _filter_spans
    try:
        from .layers.layer2_eu_pii import eu_pii_collect_batch, ensure_eu_pii_available
        ensure_eu_pii_available()
        _eu_pii_ok = True
    except Exception as e:
        logger.info("EU-PII unavailable for verification (%s) — HEALTH samples will be empty.", e)
        _eu_pii_ok = False

    yield stream_event("progress", stage="read", message="Bestanden inlezen...", progress=5)

    try:
        df_original = _read_input(original_path, sep)
        df_anon = _read_input(anonymized_path, sep)
    except Exception as e:
        yield stream_event("error", code="error.backend", error=f"Kon bestanden niet lezen: {e}")
        return

    valid_cols = [c for c in columns if c in df_original.columns and c in df_anon.columns]
    if not valid_cols:
        yield stream_event("error", code="error.no_data", error="Geen overeenkomende kolommen gevonden in beide bestanden.")
        return

    total_rows = len(df_original)

    # Optionally sample a random subset of rows for faster verification.
    import random
    if sample_rows and sample_rows < total_rows:
        sampled_indices = sorted(random.sample(range(total_rows), sample_rows))
        yield stream_event("progress", stage="read", message=f"{total_rows} rijen gevonden, steekproef {sample_rows}. Tags tellen...", progress=10)
    else:
        sampled_indices = list(range(total_rows))
        yield stream_event("progress", stage="read", message=f"{total_rows} rijen gevonden. Tags tellen...", progress=10)

    # Count tags in anonymized output
    _TAG_RE = re.compile(r'\[(NAME|PII|LOCATION|TITLE|HEALTH)\]')
    total_cells = 0
    affected_cells = 0
    total_entities = 0
    tag_counts = {"NAME": 0, "PII": 0, "LOCATION": 0, "TITLE": 0, "HEALTH": 0}

    for col in valid_cols:
        for val in df_anon[col]:
            if pd.isna(val) or not isinstance(val, str) or not val.strip():
                continue
            total_cells += 1
            matches = _TAG_RE.findall(val)
            if matches:
                affected_cells += 1
                total_entities += len(matches)
                for tag in matches:
                    tag_counts[tag] += 1

    yield stream_event("progress", stage="process", message="Presidio verificatie uitvoeren op originele tekst...", progress=20)

    layer_config = {"names": True, "locations": True, "pii": True, "titles": True}
    missed_counts = {"NAME": 0, "PII": 0, "LOCATION": 0, "TITLE": 0, "HEALTH": 0}
    missed_samples = {"NAME": [], "PII": [], "LOCATION": [], "TITLE": [], "HEALTH": []}
    removed_samples = {"NAME": [], "PII": [], "LOCATION": [], "TITLE": [], "HEALTH": []}

    for col_idx, col in enumerate(valid_cols):
        base_progress = 20 + int(75 * (col_idx / len(valid_cols)))
        yield stream_event("progress", stage="process", message=f"Kolom controleren: {col}...", progress=base_progress)

        # Batch EU-PII spans for the sampled rows only (transformer hates row-by-row).
        col_eu_spans_by_idx: dict[int, list] = {}
        if _eu_pii_ok:
            col_indices: list[int] = []
            col_texts: list[str] = []
            for idx in sampled_indices:
                ov = df_original[col].iloc[idx]
                if isinstance(ov, str) and ov.strip():
                    col_indices.append(idx)
                    col_texts.append(ov)
            if col_texts:
                try:
                    batched = eu_pii_collect_batch(col_texts, layer_config)
                    col_eu_spans_by_idx = dict(zip(col_indices, batched))
                except Exception as e:
                    logger.warning("EU-PII verification batch failed for column '%s': %s", col, e)

        for idx in sampled_indices:
            original_val = df_original[col].iloc[idx]
            anonymized_val = df_anon[col].iloc[idx]

            if pd.isna(original_val) or not isinstance(original_val, str) or not original_val.strip():
                continue

            raw_spans = collect_presidio_spans(original_val, layer_config)
            raw_spans = list(raw_spans) + list(col_eu_spans_by_idx.get(idx, []))
            filtered_spans = _filter_spans(original_val, raw_spans, layer_config)
            for start, end, tag in filtered_spans:
                key = tag.strip("[]")
                if key not in missed_counts:
                    continue
                entity_text = original_val[start:end]
                # Skip subword/fragment artifacts emitted by HF tokenizers
                # (e.g. "HD" from "ADHD", "stoor" from "stoornis").
                if len(entity_text.strip()) < 3:
                    continue
                # Word-boundary match avoids substring false positives like
                # "burn" being found inside "[HEALTH] burn-out".
                survived = isinstance(anonymized_val, str) and bool(
                    re.search(rf"\b{re.escape(entity_text)}\b", anonymized_val, re.IGNORECASE)
                )
                if survived:
                    missed_counts[key] += 1
                    if entity_text not in missed_samples[key]:
                        missed_samples[key].append(entity_text)
                else:
                    if entity_text not in removed_samples[key]:
                        removed_samples[key].append(entity_text)

        col_progress = 20 + int(75 * ((col_idx + 1) / len(valid_cols)))
        yield stream_event("progress", stage="process", message=f"Kolom '{col}' klaar.", progress=col_progress)

    yield stream_event("progress", stage="save", message="Rapport opslaan...", progress=97)

    _write_report(
        input_path=original_path,
        output_path=anonymized_path,
        columns=valid_cols,
        layers=["presidio"],
        total_rows=total_rows,
        total_cells=total_cells,
        affected_cells=affected_cells,
        total_entities=total_entities,
        tag_counts=tag_counts,
        missed_counts=missed_counts,
        missed_samples=missed_samples,
        removed_samples=removed_samples,
    )

    yield stream_event("success", message="Verificatie voltooid", progress=100, rows_processed=total_rows, columns_anonymized=valid_cols, stats={
            "total_cells": total_cells,
            "affected_cells": affected_cells,
            "total_entities": total_entities,
            "tag_counts": tag_counts,
            "missed_counts": missed_counts,
            "missed_samples": missed_samples,
            "removed_samples": removed_samples,
        })


if __name__ == "__main__":
    INPUT_FILE = "data.csv"
    OUTPUT_FILE = "data_clean.csv"
    TARGET_COLUMNS = ["feedback_text", "open_comments"]

    process_file_with_layers(
        INPUT_FILE, OUTPUT_FILE, TARGET_COLUMNS, ["presidio", "eu-pii"]
    )

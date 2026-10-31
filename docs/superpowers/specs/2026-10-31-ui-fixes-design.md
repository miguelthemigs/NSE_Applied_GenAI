# NSE Insights — UI/UX fixes: design spec

**Date:** 2026-10-31 · **Source review:** `docs/ui-review/index.html` (30 Sep 2026) · **Mockups:** https://claude.ai/artifact/9oSEtxo4yfrafwHqEJx56u

This spec turns the review's 7 fixes into decisions. It merges three independent investigations of the code (UX, technical architecture, devil's advocate). Where they disagreed, the decision and the reason are recorded here.

## What the investigation found that the review missed

1. **The Overview "error" theme is a data bug, not a wording problem.** `/api/themes-overview` returns `{"status":"error","error":"…"}` with HTTP 409 on any failure (`src/api/insight_routes.py:253-254`). `Overview.jsx:70` does `data?.themes ?? data`, so the keys `status` and `error` become two themes. That explains "2 themes", "0 comments" and "error" as the top theme. The 409 is raised by `validate_theme_classification` whenever collection metadata is not `ready`, for example after an interrupted build.
2. **Summaries are deleted before a build even starts.** `vector_routes.py:25,48` and `vector_builder.py:665,856` delete `gemma_cache.json` at the *start* of a vector build or rerank. A failed or cancelled build therefore still wipes every summary. The success-time deletions (`vector_builder.py:478,591`) are legitimate.
3. **Steps jump to the next tab automatically after success, which hides the result.** See `VectorDBBuilder.jsx:143`, `ThemeReranker.jsx:71` and `InsightGenerator.jsx:231`.
4. **The "Processing Stream 0%" panel is a one-line bug** (`AnonymizerTab.jsx:738`: `progress < 100` after loading a previous report).
5. **Model downloads have no progress hook.** llama-server downloads via `-hf` into the HF hub cache. A 180 s startup timeout (`settings.py:16`) means a first-time large download fails while the download keeps running in the background.
6. **CI runs no tests and no lint.** The 52 unittest tests in `tests/` never run.
7. **Dead code:** `VectorDBContext` (never consumed), `useApiData` and `services/api.js` (point at a non-existent `:8000` FastAPI), `isProcessing` in `PipelineDemo.jsx` (never set). There are about 30 hardcoded `http://localhost:5001` URLs.

## Decisions

| # | Decision | Why |
|---|---|---|
| D0 | **Fix 0 comes first:** Overview error handling, cache invalidation on success only, CI runs tests. | Polishing the UI over a broken data layer produces checkmarks that disagree with the Overview. |
| D1 | **i18n:** a small custom `I18nProvider` with `nl.json`/`en.json` and `Intl` formatting. No react-i18next. Default `nl`, saved in `localStorage['nse.lang']`. | Two languages and a few plurals. This adds about 1 KB instead of about 40 KB. |
| D2 | Backend stream events gain `code` + `params`. The UI translates `code`. The English `message` is shown only inside "Show details". | Removes English f-strings from the UI without rewriting the backend. |
| D3 | Theme names stay English as **data keys**. The display name comes from `t('theme.<key>')`. | Keys are used in cache lookups, so translating them would break caching. |
| D4 | **Out of scope:** the language of the LLM-generated summary text (the prompts are English). Recorded as a follow-up. | It's a prompt and quality change, not UI. Flag it to stakeholders. |
| D5 | **One source of truth for step state:** a new `GET /api/pipeline/status`. No step state is kept in localStorage. | Has to survive a restart and agree with the Overview. |
| D6 | **Soft gating:** any step can be opened, but its main button is disabled until its prerequisite is done. Step 2 needs 1. Steps 3, 4 and 5 need 2. Step 3 is optional and can be skipped; the skip is saved. | Users can read ahead, but can't start a step in the wrong order. |
| D7 | **Anonymisation safety.** Verification skipped → state `unverified` ("Niet gecontroleerd", amber), never green. Possible misses > 0 → state `needs_review`, and "Continue" stays disabled until the user ticks "I have reviewed the possible misses". The tick is saved server-side. The possibly-missed list stays visible inside the Done card. | Privacy-critical: a summary card must not hide misses. |
| D8 | **Tiers** (same per step, chosen per step): Quick = Octen 0.6B + Gemma E2B. **Balanced (default) = Octen 0.6B + Gemma 12B QAT, today's defaults.** Most thorough = Octen 4B + Gemma 26B A4B. The reranker is fixed to zerank-2. Technical names go under Advanced. | Balanced must equal the current defaults so results don't change silently. The review promised Quick = 2.6 GB (E2B). |
| D9 | **Downloads:** pre-download with `huggingface_hub.snapshot_download(tqdm_class=…)`, emit NDJSON `stage:"download"` events, then load locally. Starting the LLM becomes a stream. Fix the 180 s timeout. **This begins with a spike.** | One mechanism covers all three model types, because they share the HF cache. |
| D10 | **Write summaries:** one button, which calls `POST /api/precompute-insights {precache_subthemes:true}`. One toggle covers "every combination of year, location and programme", with an estimate from `/api/precompute-preview`. If the estimate is above 500 summaries, ask for confirmation. Study mode, language, documents per theme, clearing the cache (with confirmation) and starting the server go under Advanced. | Keeps the safety rails: the cost estimate and the confirmation before a destructive action. |
| D11 | **Visual:** the only accent is navy `primary #002f59`. Material Symbols Outlined only, self-hosted through the `material-symbols` npm package. No emoji. Dark panels are replaced by one light `ProgressPanel`. Status colours are used for status only. | The look already exists on the Overview. Self-hosting removes an external request from a local-only app. |
| D12 | **Advanced:** collapsed, closed by default, not removed. | Waiting on the stakeholder's answer. Demos and grading need model choice. |
| D13 | **Mobile:** fix horizontal overflow only. | The handover says this runs on workstations. |

## Spike result (D9, Task 12)

Measured 2026-10-31 with `huggingface_hub` 1.33.0 and llama.cpp build b11254 (`tools/llama.cpp/llama-b11254/llama-server`, the binary the app launches). Spike script: `tools/spike_hf_progress.py` (throwaway, not committed).

- **`tqdm_class` reports bytes: yes.** `snapshot_download(tqdm_class=...)` creates one aggregate byte bar, `desc="Downloading bytes"`, `unit="B"`, whose `total` equals the sum of `HfApi().model_info(files_metadata=True)` sibling sizes for the matched files (17,991,091 for bert-tiny; 90,868,988 for all-MiniLM-L6-v2 `model.safetensors`). It received 9 and 36 `update()` calls over about 0.8 s and 3.7 s (roughly 10 per second, in 1 to 2 MB chunks). Cadence depends on network speed, so Task 14 must throttle to about 2 events per second.
- **Pitfalls.** The class is instantiated several times: a `Fetching N files` bar (`unit="it"`), small bars for tiny files, and a `Reconstructing (incomplete total...)` bar that re-counts the same bytes (xet-backed repos). Filter on `unit == "B"` and `desc == "Downloading bytes"` and take the bar with the largest `total`; summing every byte bar double-counts. The aggregate bar can stop short of its total by a few percent, so report 100% from the function returning, not from the bar.
- **Polling `blobs/*.incomplete` does not work for xet-backed repos.** In both runs the poller (500 ms) saw zero `.incomplete` bytes, because the bytes land in the xet cache and the blob appears only at the end. It is a fallback only for non-xet files, so Task 14 should not rely on it.
- **llama-server `-hf` after a pre-download: verified locally.** With an isolated cache (`HF_HUB_CACHE`/`LLAMA_CACHE` pointed at a clone of the existing `unsloth/gemma-4-12B-it-qat-GGUF` snapshot: the `UD-Q4_K_XL` GGUF, `mmproj-BF16.gguf` and the `mtp-*` draft), `llama-server -hf unsloth/gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL ...` loaded the main, draft and mmproj models from the cache and reached "listening" with zero "download" lines in its log. Caveat: that cache was originally written by llama-server itself, not by `snapshot_download`. The layout is the same HF layout, so it is expected to work, but Task 14 should confirm once on a tier that was pre-downloaded by `snapshot_download`.

### Recommendation for Task 14

1. **Mechanism:** call `snapshot_download(repo_id, allow_patterns=[...], tqdm_class=ProgressTqdm)` in a job thread (`src/pipeline/jobs.py`). `ProgressTqdm.update(n)` ignores every bar except `unit == "B"` and `desc == "Downloading bytes"`, and publishes `{done: bar.n, total: bar.total}`.
2. **Cadence:** emit an NDJSON `stage:"download"` event at most every 500 ms (plus one final event), carrying `bytes_done`, `bytes_total`, and the repo.
3. **Total bytes:** the aggregate bar's `total`. Before the first update, get it from `HfApi().model_info(repo, files_metadata=True)` summed over siblings matching `allow_patterns`, so the panel shows a size immediately.
4. **No polling fallback:** `.incomplete` polling is unreliable with xet.
5. **llama-server launch mode (rewritten after fix round 1):**
   - Task 14 begins with a one-time verification on a tier written by `snapshot_download` (not llama-server): `snapshot_download` with the allow_patterns below, then `llama-server -hf <repo>:<quant> --offline`. It must reach "listening" with no download.
   - Until that is proven, a downloaded tier launches with `-hf <repo>:<quant> --offline`. This build supports `--offline` ("forces use of cache, prevents network access", env `LLAMA_ARG_OFFLINE`), so a missing file fails fast instead of silently re-downloading. If the verification fails, launch with `-m <local gguf>`, `--mmproj <local mmproj>` and the draft model args instead. Resolve the paths from the snapshot directory that `snapshot_download` returns.
   - Cache location: llama-server honours both `HF_HUB_CACHE` and `LLAMA_CACHE` (verified, see below). `llama_cpp_models.py` and `llm_clients.py` currently set no cache env, so llama-server uses its default (`~/.cache/huggingface/hub`). Task 14 must pass the same directory to `snapshot_download(cache_dir=...)` and to the llama-server process, by setting `HF_HUB_CACHE` in the launch env, or by leaving both on the default. Never set it for only one of them.

### Addendum (fix round 1)

Measured with `prajjwal1/bert-tiny` (17,991,091 bytes) and an isolated temp cache.

- **Warm cache:** a second `snapshot_download` took 0.11 s and fired only the `Fetching 5 files` bar (`unit="it"`). No `unit="B"` bar fired. Rule: before starting, compute the missing bytes (sibling sizes from `model_info`, minus files already present in the local snapshot). If nothing is missing, skip the download stage and emit no `download` event.
- **Partial cache:** with `pytorch_model.bin` (17.76 MB) already present, the aggregate "Downloading bytes" bar had `total=234698` (only the missing bytes) and its `n` counted only newly downloaded bytes. Present bytes are not included in either. The UI uses the bar's `total` and `n` once the first update arrives. Never mix the `model_info` pre-seed with the bar total after the first update; the pre-seed may differ from the bar's total (it is the full size, the bar's is the missing size), so switch bases in one step and never compute `done` from one and `total` from the other.
- **Several aggregate bars:** a cold run created aggregate bars with totals 345, 17,759,298 and 17,991,091 in turn (per-file batches). Take the bar with the largest `total` seen so far. Its summed `n` ended about 6% short of the total (16.92 of 17.99 MB), so report 100% from the function returning.
- **llama-server `--offline` and cache env (APFS clone of the 12B snapshot, `-hf ... --offline`):** with only `HF_HUB_CACHE` set, and again with only `LLAMA_CACHE` set, llama-server loaded the main, draft and mmproj models from the clone (log paths pointed into the clone) and reached "listening". So it reads both. Not verified: the exact failure message when `--offline` meets an empty cache.
- **Unknown or zero total:** send `bytes_total: null`; the UI shows an indeterminate bar with bytes done only.
- **Offline or Hub unreachable (`HF_HUB_OFFLINE` set):** `model_info` is best-effort in try/except. With the cache complete, skip the download stage; if files are missing, fail the stage clearly with `error.download_failed` (never a raw traceback).
- **Thread-safety:** the bar writes plain ints from download worker threads, and `snapshot_download` runs several files concurrently. Publish `done`/`total` as a snapshot under a lock in `src/pipeline/jobs.py`.
- **Throttle:** it lives in the publisher (at most one event per 500 ms), not in `ProgressTqdm.update`, plus one final event when the function returns.
- **Desc fragility:** select the bar by `unit == "B"` and `desc == "Downloading bytes"`; if no such bar appears, fall back to the `unit == "B"` bar with the largest `total`. Task 14 adds a unit test that pins the desc string against the installed `huggingface_hub` version.
- **Octen substitution:** the spike used `prajjwal1/bert-tiny` and `sentence-transformers/all-MiniLM-L6-v2` instead of `Octen/Octen-Embedding-0.6B`, so as not to touch the real cache. All three are xet-backed or plain-HTTP repos served the same way, but Task 14 should smoke-test on a real tier once.

## Pipeline status contract (D5)

```json
GET /api/pipeline/status → 200
{
  "status": "success",
  "last_updated": "2026-10-31T14:12:00Z" | null,
  "active_job": {"step": "vectors", "stage": "encode", "progress": 42} | null,
  "steps": {
    "anonymize": {"state": "...", "completed_at": "ISO|null",
                  "summary": {"rows": 300, "removed": 409, "review": 1, "verified": true, "acknowledged": false,
                              "by_type": {"names": 288, "locations": 16, "numbers": 73, "health": 32}}},
    "vectors":   {"state": "...", "completed_at": "...", "summary": {"documents": 900, "tier": "balanced", "model": "Octen/Octen-Embedding-0.6B"},
                  "checkpoint": {"processed": 400, "total": 900} | null},
    "rerank":    {"state": "...", "completed_at": "...", "summary": {"ambiguous": 57, "changed": 12, "low_information": 3}},
    "insights":  {"state": "...", "completed_at": "...", "summary": {"themes_done": 7, "themes_total": 7, "subthemes_done": 31, "filtered_done": 0, "filtered_total": 0}},
    "query":     {"state": "ready" | "blocked"}
  }
}
```

`state` ∈ `not_started | in_progress | interrupted | done | partial | stale | needs_review | unverified | skipped | error | blocked | ready`.

| Step | done when | other states |
|---|---|---|
| anonymize | `ANONYMIZED_CSV_PATH` + `ANON_REPORT_JSON` exist, verified, and (review = 0 or acknowledged) | `interrupted` if `ANON_CHECKPOINT_META` exists. `unverified` if verification was skipped. `needs_review` if review > 0 and not acknowledged. |
| vectors | `vector_db_is_ready()` | `interrupted` if collection status is `building` or `VECTOR_CHECKPOINT` exists. `stale` if anonymize `completed_at` > vectors `completed_at`. `blocked` if anonymize is not done. |
| rerank | `theme_reranker_status == "completed"` | `skipped` if the skip flag is set. `stale` if vectors `completed_at` > rerank `completed_at`. `blocked` if vectors are not done. |
| insights | `themes_done >= themes_total` (7) | `partial` if 0 < done < 7. `stale` if `cache_matches_generation_settings()` is false. `blocked` if vectors are not done. |
| query | — | `ready` if vectors are done, else `blocked`. |

Timestamps live in `data/pipeline_state.json`:
`{"anonymize":{"completed_at":…,"acknowledged":bool},"vectors":{"completed_at":…,"tier":…},"rerank":{"completed_at":…,"skipped":bool,"stats":{…}},"insights":{"completed_at":…}}`.
If an entry is missing, fall back to the artefact file's mtime.

## Copy (NL is the default; EN mirrors it)

### Step names and one-liners

| key | NL | EN |
|---|---|---|
| `step.anonymize` | Persoonsgegevens verwijderen | Remove personal details |
| `step.anonymize.lead` | We halen namen, adressen, studentnummers en gezondheidsinformatie uit de antwoorden, zodat niemand herkenbaar is. | We remove names, addresses, student numbers and health details from the answers so no one can be identified. |
| `step.vectors` | Antwoorden doorzoekbaar maken | Prepare answers for search |
| `step.vectors.lead` | De AI leest alle antwoorden één keer, zodat je ze daarna op betekenis kunt doorzoeken en groeperen. | The AI reads every answer once, so you can then search and group them by meaning. |
| `step.rerank` | Thema's controleren | Double-check themes |
| `step.rerank.lead` | Sommige antwoorden passen bij meer dan één thema. Een tweede, zorgvuldigere AI leest die opnieuw en kiest het beste thema. Duidelijke antwoorden blijven ongewijzigd. | Some answers could fit more than one theme. A second, more careful AI reads those again and picks the best theme. Answers that were already clear are left alone. |
| `step.insights` | Samenvattingen schrijven | Write summaries |
| `step.insights.lead` | De AI schrijft per thema een samenvatting met voorbeeldreacties en verbeterpunten. Die verschijnen op het Overzicht. | The AI writes a summary per theme, with example comments and suggestions. They appear on the Overview. |
| `step.query` | Stel een vraag | Ask a question |
| `step.query.lead` | Typ een vraag in gewone taal en zie welke studentantwoorden erbij passen. | Type a question in plain language and see which student answers match. |

### Step states

| key | NL | EN |
|---|---|---|
| `state.not_started` | Nog niet gedaan | Not done yet |
| `state.blocked` | Eerst stap {n} | Do step {n} first |
| `state.next` | Volgende stap | Next step |
| `state.in_progress` | Bezig… {pct}% | In progress… {pct}% |
| `state.interrupted` | Onderbroken, je kunt verdergaan | Interrupted, you can resume |
| `state.done` | Klaar | Done |
| `state.partial` | Deels klaar ({x} van {y}) | Partly done ({x} of {y}) |
| `state.stale` | Bijwerken nodig | Needs updating |
| `state.skipped` | Overgeslagen | Skipped |
| `state.error` | Niet gelukt | Didn't finish |
| `state.needs_review` | {n} om na te kijken | {n} to review |
| `state.unverified` | Niet gecontroleerd | Not checked |
| `state.ready` | Klaar voor gebruik | Ready to use |

### Done cards

| key | NL | EN |
|---|---|---|
| `done.anonymize` | Klaar. {rows} antwoorden gecontroleerd, {removed} persoonsgegevens verwijderd, {review} om na te kijken. | Done. {rows} answers checked, {removed} personal details removed, {review} to review. |
| `done.anonymize.clear` | Klaar. {rows} antwoorden gecontroleerd, {removed} persoonsgegevens verwijderd. Alles in orde. | Done. {rows} answers checked, {removed} personal details removed. All clear. |
| `done.anonymize.ack` | Ik heb de mogelijke missers bekeken | I have reviewed the possible misses |
| `done.vectors` | Klaar. {docs} antwoorden zijn doorzoekbaar (model: {tier}). | Done. {docs} answers are ready for search ({tier} model). |
| `done.rerank` | Klaar. {checked} twijfelgevallen opnieuw gelezen; {changed} kregen een beter passend thema. {lowinfo} antwoorden zonder echte inhoud zijn apart gezet. | Done. {checked} unclear answers re-read; {changed} moved to a better theme. {lowinfo} answers with no real content were set aside. |
| `done.insights` | Klaar. Samenvattingen voor {n} van {total} thema's staan op het Overzicht. | Done. Summaries for {n} of {total} themes are on the Overview. |
| `done.updated` | Laatst bijgewerkt: {date} | Last updated: {date} |
| `action.continue` | Verder naar stap {n} | Continue to step {n} |
| `action.openOverview` | Bekijk het Overzicht | Open the Overview |
| `action.runAgain` | Opnieuw uitvoeren | Run again |
| `action.skip` | Stap overslaan | Skip this step |
| `action.details` | Details tonen | Show details |
| `action.advanced` | Geavanceerd | Advanced |
| `gate.reason` | Doe eerst stap {n}: {name} → | Do step {n} first: {name} → |
| `banner.welcomeBack` | Welkom terug. Je eerdere werk is bewaard (laatst bijgewerkt {date}). | Welcome back. Your earlier work was saved (last updated {date}). |
| `page.title` | Analyse in 5 stappen | Analysis in 5 steps |
| `page.lead` | Van ruwe enquêtereacties naar samenvattingen op het Overzicht. Je werk wordt bewaard, ook na een herstart. | From raw survey comments to summaries on the Overview. Your work is saved, even after a restart. |

### Tiers, downloads and stages

| key | NL | EN |
|---|---|---|
| `tier.quick` / `.lead` | Snel · Goed voor een eerste indruk. Kleinste download. | Quick · Good for a first look. Smallest download. |
| `tier.balanced` / `.lead` | Gebalanceerd (aanbevolen) · De beste mix van snelheid en kwaliteit voor de meeste rapporten. | Balanced (recommended) · Best mix of speed and quality for most reports. |
| `tier.thorough` / `.lead` | Meest grondig · De beste kwaliteit voor het eindrapport. Het traagst; vraagt een krachtige computer. | Most thorough · Best quality for the final report. Slowest; needs a powerful computer. |
| `tier.cached` / `tier.download` | Al op deze computer / Eenmalige download ({size}) | Already on this computer / One-time download ({size}) |
| `download.running` | Het {tier}-model wordt gedownload: {done} van {total} · nog ongeveer {min} min | Downloading the {tier} model: {done} of {total} · about {min} min left |
| `download.unknown` | Het {tier}-model wordt gedownload… Dit gebeurt maar één keer. | Downloading the {tier} model… This only happens once. |
| `download.failed` | Downloaden is niet gelukt. Controleer de internetverbinding en probeer het opnieuw. | The download didn't finish. Check the internet connection and try again. |
| `stage.load` / `read` / `process` / `save` | Model laden / Gegevens lezen / Verwerken / Opslaan | Load model / Read data / Process / Save |

### Write summaries and Overview

| key | NL | EN |
|---|---|---|
| `insights.run` | Samenvattingen schrijven | Write summaries |
| `insights.filtered` | Ook samenvattingen voor elke combinatie van jaar, locatie en opleiding (duurt langer: {count} samenvattingen, ongeveer {min} min) | Also write summaries for every combination of year, location and programme (takes longer: {count} summaries, about {min} min) |
| `insights.confirmLarge` | Dit zijn {count} samenvattingen en duurt ongeveer {hours} uur. Doorgaan? | This is {count} summaries and takes about {hours} hours. Continue? |
| `insights.row.main` / `.sub` / `.filtered` | Hoofdthema's / Subthema's / Per jaar, locatie en opleiding | Main themes / Sub-themes / Per year, location and programme |
| `insights.clearCache` / `.confirm` | Opgeslagen samenvattingen wissen / Weet je het zeker? Alle samenvattingen worden verwijderd. | Clear saved summaries / Are you sure? All summaries will be deleted. |
| `overview.empty` / `.emptyAction` | Er zijn nog geen samenvattingen / Ga naar stap 4: Samenvattingen schrijven | No summaries yet / Go to step 4: Write summaries |
| `overview.notReady` | De gegevens worden nog voorbereid. Rond stap 2 af en probeer het opnieuw. | The data is still being prepared. Finish step 2 and try again. |
| `overview.offline` | De analyse-service is niet bereikbaar. Start de app opnieuw. | The analysis service can't be reached. Restart the app. |

The full per-component string inventory (current text, NL and EN, by file:line) is in `docs/superpowers/specs/2026-10-31-ui-strings-inventory.md`.

## Visual tokens (D11)

The accent is `primary #002f59`, with hover `primary-container #00467f` and tint `primary-fixed #d3e3ff`. The surface is `#f8f9fa`, cards are `#fff`, insets are `#f3f4f5`, borders are `outline-variant #c2c6d1`, text is `on-surface #191c1d`, secondary text is `on-surface-variant #424750`, and muted text is `outline #727781`. New tokens: `success #1e7a3a / success-container #e6f4ea`, `warning #8a5300 / warning-container #fff1d6`. Existing: `error #ba1a1a / error-container #ffdad6`. Headings use Manrope and body text uses Inter. Cards are `rounded-2xl` and controls `rounded-xl`. Motion is 150–200 ms fades, with `prefers-reduced-motion` respected.

Step icons: `shield_person`, `manage_search`, `fact_check`, `summarize`, `question_answer`. Other icons: done `check_circle`, running `progress_activity`, advanced `tune`, download `download`, language `translate`.

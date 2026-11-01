# System Handover & Technical Documentation

This document serves as the comprehensive technical handover guide for the Fontys survey analysis dashboard project. It outlines the architecture, pipeline steps, hardware deployment constraints, known limitations, and a direct roadmap for the next development team.

---

## 1. System Architecture & Tech Stack

The application follows a client-server architecture designed for local-first deployment, ensuring data privacy by performing all NLP and LLM tasks on local hardware.

```mermaid
graph TD
    %% Frontend Components
    subgraph Frontend ["React Frontend (Vite)"]
        App["App.jsx (Router)"] --> NavBar["NavBar.jsx"]
        App --> Overview["Overview.jsx (Dashboard Overview)"]
        App --> Vergelijken["Vergelijken.jsx (Comparison Page)"]
        App --> ViewMorePage["ViewMorePage.jsx (Detailed Theme Analysis)"]
        App --> PipelineDemo["PipelineDemo.jsx (Pipeline Diagnostics)"]
        
        Overview --> HeroBanner["HeroBanner.jsx"]
        Overview --> ThemeCard["ThemeCard.jsx"]
        Overview --> ThemeBarChart["ThemeBarChart.jsx"]
        
        Vergelijken --> ComparisonMiniChart["ComparisonMiniChart.jsx"]
        Vergelijken --> FilterDropdown["FilterDropdown.jsx"]
        
        ViewMorePage --> SubthemeWordCloud["SubthemeWordCloud.jsx"]
        ViewMorePage --> TrendChart["TrendChart.jsx"]
        ViewMorePage --> DetailDrawer["DetailDrawer.jsx"]
        
        PipelineDemo --> AnonymizerTab["AnonymizerTab.jsx"]
        PipelineDemo --> VectorDBBuilder["VectorDBBuilder.jsx"]
        PipelineDemo --> ThemeReranker["ThemeReranker.jsx"]
        PipelineDemo --> InsightGenerator["InsightGenerator.jsx"]
        
        subgraph StateManagement ["State & Context"]
            VectorDBProvider["VectorDBContext.jsx (Global DB State & Filters)"]
        end
    end

    %% Python Backend Components
    subgraph Backend ["Python Backend Pipeline"]
        API["FastAPI / Routing"]
        
        subgraph Stage1 ["Stage 01: Anonymization (privacy_pipeline.py)"]
            Presidio["Layer 1: Presidio + Custom Dutch Recognizers"]
            EuPII["Layer 2: HF token-classification (eu-pii-safeguard)"]
            LateMask["Late-Masking Coordinate System"]
        end
        
        subgraph Stage2 ["Stage 02: Embedding & Classification (vector_builder.py)"]
            EmbeddingModel["BAAI/bge-m3 Embedding Model"]
            Similarity["O(k) Centroid Cosine Similarity"]
            ThemeClassifier["theme_classifier.py"]
        end
        
        subgraph Stage3 ["Stage 03: Retrieval (retrieval/service.py)"]
            Chroma["ChromaDB (SQLite Persistence)"]
            MetadataFilters["Demographic & Scalar Filters"]
            Reranker["zeroentropy/zerank-2-reranker (Cross-Encoder)"]
        end

        subgraph Stage4 ["Stage 04: Generation (generation/service.py)"]
            MapReduce["Hierarchical Map-Reduce RAG (Batch = 60)"]
            LlamaCpp["llama.cpp client (gemma4:e4b)"]
            Cache["cache.py (Disk Serialization)"]
            Metrics["insight_metrics.py (NLP validation)"]
        end
    end

    %% Connect Frontend to Backend API
    AnonymizerTab --> API
    VectorDBBuilder --> API
    ThemeReranker --> API
    InsightGenerator --> API
    VectorDBProvider --> API

    %% Backend Pipeline Flow
    API --> Stage1
    Stage1 --> Stage2
    Stage2 --> Stage3
    Stage3 --> Stage4
    Stage4 --> API
```

### Frontend Technology Stack
- **Framework**: React (Vite-powered SPA bundle).
- **Styling**: TailwindCSS for component styling and responsive glassmorphism.
- **Routing**: `react-router-dom` using lazy-loaded code-splitting for performant page navigation.
- **Core Components**:
  - `Overview.jsx`: Main summary view exhibiting aggregate distributions and theme cards.
  - `Vergelijken.jsx`: Multi-dimensional demographic slice comparisons using interactive filtering.
  - `ViewMorePage.jsx`: Deep dive into specific themes, featuring token subtheme distribution charts, trend analyses, raw comment lists with highlighting, and a side detail drawer.
  - `PipelineDemo.jsx`: Control dashboard enabling users to trigger anonymization trials, vector indexing, reranking iterations, and LLM summary generation directly.

### Backend Pipeline Architecture
- **Framework**: Python 3.10+ modular backend pipeline containing four sequentially decoupled packages:
  - `01_anonymization`: Privacy sanitization wrapper.
  - `02_embedding`: Numerical vector construction and theme mapping.
  - `03_retrieval`: Filtered database querying and rank verification.
  - `04_generation`: Structured local LLM summarization.

### Vector Database
- **ChromaDB**: Persisted locally as a SQLite `.sqlite3` file structure (`survey_vector_db/`). Documents are cached alongside customized metadata dimensions to bypass indexing cycles on standard queries.

### Production Models
- **Embeddings**: `BAAI/bge-m3` (utilizing a local PyTorch `SentenceTransformer` runtime) to produce 1024-dimensional dense representations matching multilingual inputs.
- **Reranker (Optional)**: `zeroentropy/zerank-2-reranker` (Cross-Encoder) resolving boundary classification issues in ambiguous inputs.
- **Centroid Classification & Summarization**: `gemma4:e4b` (`unsloth/gemma-4-E4B-it-qat-GGUF:UD-Q4_K_XL` quant format) deployed via **llama.cpp** (`llama-server`) for fast, local structured completions.

---

## 2. Hardware & Deployment Advisory

To achieve privacy compliance, all inference runtimes are self-hosted on the host system. This local-only deployment introduces specific hardware runtime constraints.

> [!IMPORTANT]  
> **Minimum RAM Requirement: 16 GB**  
> Running the 4-B parameter LLM (`gemma-4-E4B-it-qat-GGUF`) locally alongside the spaCy NER engines and Hugging Face token classification pipeline requires a hard minimum of **16 GB RAM** (or unified memory on Apple Silicon).

### Deployment Model
- Deployed as a local **Server-Client architecture**.
- The backend starts a managed `llama-server` subprocess at `127.0.0.1:8080` with configurable options (context length, temperature, and GPU layer configuration).
- The React application communicates with python services using HTTP endpoints, and the python services proxy LLM generation tasks to `llama-server`.

### Hardware Safety Warning
> [!WARNING]  
> Do not attempt to run vector DB building and LLM summaries on standard, thin-and-light QA office laptops (e.g., standard Intel Core i5 with no dedicated graphics card and low cooling capacity). 
> - Sustained 100% CPU inference on non-workstation laptops will lead to severe **thermal throttling, application freezes, out-of-memory (OOM) kernel kills, or system crashes**.
> - Workstations equipped with modern dedicated GPUs (NVIDIA CUDA or AMD ROCm) or Apple Silicon devices (M-series Macs with unified memory) are strongly recommended for seamless performance.

---

## 3. The Data Pipeline (Step-by-Step)

The data flows through a strict, linear pipeline ensuring anonymization prior to vectorization and synthesis.

```
[Raw CSV] ──► [Multi-Layer Anonymizer] ──► [1-Cell to 1-Doc Ingestion] ──► [O(k) Centroid Cosine Sim] ──► [Hierarchical Map-Reduce RAG] ──► [JSON Dashboard Cache]
```

### Step 1: Anonymization (`privacy_pipeline.py`)
To prevent data leaks, the pipeline applies a multi-layered privacy approach before storing any texts.

1. **Layer 1 (Presidio)**: Microsoft Presidio is configured with spaCy model loaders (`nl_core_news_lg`, `en_core_web_lg`, and `de_core_news_lg`) alongside **custom regex and pattern recognizers** to identify Dutch educational and generic PII markers:
   - *Student Numbers*: Matches standard Dutch college IDs (`r"\b[0-9]{5,7}\b"`).
   - *Dutch BSN*: Ten-digit and dotted identification numbers.
   - *Dutch Postcodes & Mobile Phones*: Direct matching of standard formats.
   - *Teacher Name Context*: Special triggers identifying names following words like `Docent`, `Teacher`, `Mentor`, or `Professor`.
   - *Building & Floor Identifiers*: Detects references like `Room TQ 2.12` or `3e etage`.
2. **Layer 2 (Hugging Face / EU PII)**: TabularisAI's `eu-pii-safeguard` token classification model operates on CPU/GPU to capture complex European PII and medical descriptors.
3. **Late-Masking Coordinate System**: 
   - Traditional text anonymization uses sequential string replacement (regex-replacing substrings as they are found). However, this method shifts character indices, invalidating subsequent offsets and frequently causing text corruption (e.g., masking the middle of an already masked token like `[NAME]` into `[[NAME]]`).
   - The pipeline resolves this by collecting entity spans `(start_index, end_index, tag)` from all models in coordinate space. Spans are extended to cover Dutch possessives (e.g., `Janssen's` is normalized to catch the `'s` extension) and surrounding quotes in `extend_spans_for_original()`.
   - All spans are merged and deduplicated in index space.
   - The masking is applied **exactly once from right to left** (descending start indices) to preserve absolute document coordinate offsets.
4. **Carry-Forward Logic**: 
   - If a high-confidence personal name is detected (e.g., `"Mr. Hendriks"`), the exact string `"Hendriks"` is appended to a dynamic lookup map. 
   - The pipeline carries this name list forward, matching and masking sub-occurrences within that cohort block even if the name appears context-free later.

### Step 2: Ingestion & Vector Chunking Strategy
- **1-Cell to 1-Document Mapping**: The pipeline converts every cell of a text response column into an individual document in ChromaDB.
- **Why Semantic Chunking was Abandoned**:
  1. *Metadata Preserving*: Survey responses are accompanied by demographic and course-related metadata (academic year, location, programme, cohort). If a response was split into arbitrary semantic pieces, linking those pieces back to the original respondent's metadata would require complex overhead or duplicate storage.
  2. *Cohesion & Context*: Student feedback responses are already short (typically 1 to 3 sentences). Fragmenting them further leads to a loss of context.
  3. *Filtering Integrity*: Demographically sliced retrieval (e.g., "Show feedback from the Cohort 2024 VT at Eindhoven") works best when entire responses are returned as a single, coherent document.

### Step 3: Insight Generation & O(k) Clustering
Standard LLM-based categorization of $n$ feedback responses is computationally expensive, scaling at $O(n)$ where every response requires an LLM inference call. For a dataset of 10,000 documents, this process takes hours.

To bypass this bottleneck, the pipeline implements an **$O(k)$ Centroid-based Classification Approach**:
1. **Centroid Encoding**: During initialization, the pipeline embeds the structural descriptions of the $k$ target themes (defined in `src/config/themes.py`) using the embedding model to create a set of $k$ theme centroids in the vector space.
2. **Matrix Dot Product**: Instead of calling an LLM, the system performs a matrix multiplication of the document embeddings against the theme centroids ($O(k)$ vector operations). This maps each document to its closest candidate categories in milliseconds.
3. **Targeted Reranking**: The cross-encoder is only invoked for ambiguous items (where the distance margin between the top two candidate themes is less than `THEME_AMBIGUITY_SCORE_MARGIN`). The pipeline runs the reranker on just these $c$ candidates (where $c = 3$ by default) instead of the entire dataset. This hybrid approach drops overall computing time from **hours to minutes**.
4. **Hierarchical Map-Reduce RAG**:
   - To compile theme summaries, the backend reads all assigned documents (which can count in the hundreds or thousands).
   - Rather than overflowing the context window, the system groups documents into batches of `HIERARCHICAL_RAG_BATCH_DOCUMENTS` (default: `60`).
   - The local LLM processes each batch in parallel or quick sequence, extracting key concerns, subthemes, and student suggestions (the **Map** step).
   - A final **Reduce** prompt receives only the batch summaries and synthesizes them into the final JSON dashboard payload.

---

## UI state model

The pipeline page and the Overview read one source of truth for what is done. No step state lives in `localStorage` (it only holds `nse.lang`, plus `sessionStorage['nse.welcomed']` for the once-per-session banner). Spec: `docs/superpowers/specs/2026-10-31-ui-fixes-design.md`.

### Status endpoint

`GET /api/pipeline/status` (`src/api/pipeline_routes.py`, built by `src/pipeline/status.py`) returns `status`, `last_updated`, `active_job` and one entry per step (`anonymize`, `vectors`, `rerank`, `insights`, `query`), each with `state`, `completed_at` and a `summary`. `state` is one of `not_started | in_progress | interrupted | done | partial | stale | needs_review | unverified | skipped | error | blocked | ready`. The "done when" rules per step are in the spec table (D5). Every step is built inside `_safe(...)`, so one failing step shows `error` and does not break the others. The frontend polls it and shows the offline banner when it cannot be reached.

### `data/pipeline_state.json`

Written only by `src/pipeline/state.py` (atomic write through a `.tmp` file, guarded by `state_lock`). It holds timestamps and flags: `anonymize.{completed_at, acknowledged, acknowledged_report}`, `vectors.{completed_at, model, documents, tier}`, `rerank.{completed_at, skipped, stats}`, `insights.{completed_at}`. If the file or an entry is missing, `completed_at` falls back to the artefact's mtime (anonymised CSV and report, `chroma.sqlite3`). Reading the status never creates the file; only a finished step, an acknowledgement or a skip does. Caveat: the mtime fallback for vectors changes when the vector DB is opened, so on a machine without the state file the vectors "last updated" time can move after a backend restart. It stops once step 2 has been run once.

### Jobs registry

`src/pipeline/jobs.py` keeps the one currently streaming job in memory (`start_job`, `update_job`, `finish_job`, `tracked_stream`). `tracked_stream` takes the slot atomically (`try_start`) before the first event and raises `JobBusy` when another job runs; the routes turn that into 409 `error.busy` (`src/api/guards.py`, which also holds the step-1 `anonymize_gate` used by steps 2 to 5). It is in memory on purpose: after a restart no job is active, so a half-finished step reads as `interrupted`, never as `in_progress` forever. All thread-safe code lives here; `app.py` must not import `threading` (enforced by `tests/test_app_startup.py`).

### Review gate and the step-2 gate

- Verification skipped gives `unverified` (amber, never green). Possible misses with no acknowledgement give `needs_review`. The possibly-missed list stays visible inside the Done card.
- `POST /api/pipeline/acknowledge-review` stores the tick, tied to the report id (the report `timestamp`). If a newer report exists the server refuses and the UI asks for a fresh look. Re-running step 1 resets the acknowledgement (`ACK_RESET`).
- `POST /api/build-vectors` is gated on the server (`_anonymize_gate` in `src/api/vector_routes.py`): it answers `409` with `code: "error.blocked"` unless step 1 is `done`. It fails closed if the status cannot be built. The UI disables the button too, but the server is the real gate.
- `POST /api/pipeline/skip-rerank` saves the skip of optional step 3.

### i18n

`dashboard/src/i18n/I18nProvider.jsx` is a small custom provider (no react-i18next). Dictionaries: `dashboard/src/i18n/locales/nl.json` and `en.json`. Default is `nl`, saved in `localStorage['nse.lang']` (every storage access is in try/catch). Use `const { t } = useI18n()`.

Key conventions: `step.<id>` and `step.<id>.lead`; `state.<state>`; `done.<step>`; `error.<code>`; `theme.<key>` (theme names stay English as data and cache keys, only the display name is translated). Backend stream events carry `code` and `params`; the UI translates `code`, and the raw English `message` appears only behind "Details tonen / Show details". Add every key to both files.

`npm run check:copy` (`dashboard/scripts/check-copy.mjs`) scans `src/components` and `src/pages` and fails on banned literals, emoji, the glyphs U+2713 and U+00D7, inline `<svg>` in the pipeline scope, and old-palette Tailwind classes. The banned list is `dashboard/scripts/banned-copy.mjs`: `Drop your CSV`, `Vorige run`, `Check uitvoeren`, `Overslaan`, `not_run`, `Launch `, `Vector DB`, `Reranker`, `Processing Stream`. The e2e language spec reuses the same list on rendered text. Not covered: the language of the LLM summary text (prompts are English; recorded follow-up, D4).

### Model tiers

`dashboard/src/config/modelTiers.json` (read through `modelTiers.js`) is the single place. Quick = Octen 0.6B + Gemma E2B; Balanced (default, equals the old defaults) = Octen 0.6B + `gemma-4-12B-it-qat-GGUF:UD-Q4_K_XL`; Most thorough = Octen 4B + Gemma 26B A4B. Tiers are chosen per step (step 2 picks the embedding model, step 4 the LLM). The reranker is fixed. Technical model IDs only show under Advanced.

### Download progress

`src/pipeline/model_downloads.py` pre-downloads with `huggingface_hub.snapshot_download(tqdm_class=...)` and emits NDJSON events with `stage: "download"` and `bytes_done` / `bytes_total` (throttled to about two per second; `bytes_total: null` means indeterminate). If nothing is missing it emits no download event. The frontend maps them in `dashboard/src/utils/downloadProgress.js`. `POST /api/llm-models/start-stream` is the only path that downloads an LLM; every other route answers `409 error.model_missing` when the files are not local. The embedding model is downloaded inside the step 2 stream. llama-server is started from the local cache with `--offline`. Details and measurements: the spike section of the spec.

### Add a step

1. Add an entry to `dashboard/src/config/pipelineSteps.js` (`id`, `n`, `icon`, `requires`, `optional`).
2. Add `step.<id>`, `step.<id>.lead` and its `done.<id>` message to `nl.json` and `en.json`.
3. Backend: add a `_<id>_step` builder in `src/pipeline/status.py` and register it in `build_pipeline_status()` (wrap it in `_safe`). Call `state.mark_completed("<id>")` when the step succeeds, and run its stream through `jobs.tracked_stream`. Gate it on the server if it must not run out of order.
4. Add the step component under `dashboard/src/components/` using the shared pipeline pieces (`components/pipeline/`: `ProgressPanel`, Done card, `TierPicker`).
5. Add a status fixture in `dashboard/e2e/fixtures/status/` and cover it in the stepper and done-card specs.

### E2E harness

`npm run e2e` (Playwright, `desktop` and `mobile` projects, config in `dashboard/playwright.config.js`) never needs the real backend or models. `dashboard/e2e/fixtures/api.js` provides the `mockApi` fixture that intercepts every `/api/` call (plain JSON, `{json,status}`, `{ndjson:[...]}` streams or functions; unlisted paths answer 404; `mockApi.requests` records calls). The Vite dev server is started with `VITE_API_BASE` set to the mock origin. Status payloads are in `e2e/fixtures/status/*.json`. `visual.spec.js` renders the mockup boards and writes screenshots to `e2e/__screens__/` (git-ignored). Unit tests: `npm test` (Vitest).

---

## 4. Technical Debt & Known Limitations

### Vector DB Scalability
- **ChromaDB as an MVP Decision**: ChromaDB was selected as a satisficing choice to meet the initial MVP deadline. It relies on a local SQLite file database to record metadata.
- **SQLite Performance Bottleneck**: Under load-testing at larger scales (exceeding **15,000 rows**), SQLite's write locking and file IO overhead can become a database bottleneck. 
- *Recommendation*: If scaling the survey population to hundreds of thousands of entries, ChromaDB should be migrated to a standalone client-server vector database such as **Qdrant** or **pgvector**.

### Redaction Aggressiveness
- **Over-Redaction of Educational Context**: The custom Dutch recognizers and Layer 2 models occasionally misclassify generic educational terms or codes as personal details.
- For example, terms like `"lokaal"`, mentor names, and course codes (e.g., `"R-1"`, `"TQ-A"`) might be aggressively replaced with generic tags like `[LOCATION]` or `[NAME]`, slightly reducing the readability of the student suggestion texts.
- *Recommendation*: Regularly tune the confidence thresholds (`PRESIDIO_MIN_SCORE` and `EU_PII_MIN_SCORE` in the environmental configurations) and update `_NAME_SPAN_STOPWORDS` within `privacy_pipeline.py` to prevent false positive matches.

---

## 5. Strategic Advice & Roadmap for the Next Team

The following priorities must be addressed to transition this MVP into a production-ready system.

### Architecture & Infrastructure
- **Database Migration**: Substantiate the use of ChromaDB + SQLite. For larger datasets, migrate to a scalable standalone client-server vector database such as **Qdrant** or **pgvector** to resolve SQLite write locking and performance bottlenecks.
- **Caching**: Replace the current JSON file storage with a robust, in-memory datastore like **Redis** to handle concurrent access and prevent cache timeouts.
- **Frontend Framework**: Transition from the current React SPA (Vite) to a Server-Side Rendered (SSR) framework like **Next.js** or **Remix** for better state management, server actions, and routing.
- **Containerization**: Implement **Docker** immediately. Provide a `docker-compose.yml` that spins up the frontend, backend API, and database services seamlessly.
- **Hosting Strategy**: Finalize the hosting environment early on. The available production hardware (e.g., GPU support, RAM size) will dictate whether you continue using `llama.cpp` or switch to a high-throughput engine like **vLLM**.

### AI Pipeline & Logic
- **Contextual Reranking**: The current reranker is too aggressive and strips out short answers (e.g., "Good", "Fine") because they lack theme context. **Fix**: Concatenate the original survey question to the short answer before passing it to the reranker/classifier.
- **Chunking Strategy Optimization**: Investigate optimized semantic/hierarchical chunking strategies to see if they can improve vector retrieval performance without losing crucial respondent metadata or short-answer context.
- **Sentiment Cross-Checking**: Validate open-ended text against closed-answer ratings. A comment like "Fine" on a question rated 1/10 is likely sarcastic. Use the quantitative score to weight the NLP classification (e.g., automatically tag open answers as negative if the associated closed ratings are 0 or 1).
- **System Prompts & Localization**: The LLM leans toward English outputs because the system prompt is in English. Translate the core system prompts to **Dutch** to properly handle and summarize Dutch student feedback.
- **Anonymization Tuning**: Revise the anonymization layer so it stops stripping critical educational context. Ensure labels, topics, and themes remain intact while masking actual PII.

### User Experience (UX) & Features
- **One-Click Processing**: Remove the manual pipeline configuration options and stages from the UI. The final application must be a clean "upload and click" experience without exposing technical pipeline settings to the end user.
- **Authentication**: Implement a secure login/authentication system. The current dashboard lacks necessary access controls.
- **Multilingual UI**: Add language toggles for the dashboard interface to support both **Dutch** and **English**.
- **Advanced Filtering**: Update the filter parameters to allow slicing by **Institute** rather than just by Study Program.
- **Historical Comparison**: Build a comparison view that allows administrators to compare historical data and trends year-over-year.
- **Actionable Insights**: Within the generated themes, explicitly prompt the LLM to output **Discussion Points** to spark dialogue between quality officers and students.

### Workflow & Maintenance
- **Code Cleanup**: Ruthlessly delete unused code, prototype scripts, and deprecated components to keep the repository maintainable.
- **End-User Validation**: Stop developing in a vacuum. Get the current build into the hands of actual quality officers and iterate based on their direct feedback.
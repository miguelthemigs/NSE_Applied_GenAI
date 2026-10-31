# UI fixes: acceptance record

Branch `fix/ux-ui-remake`, run 2026-10-31. Backend `.venv/bin/python app.py` on 5001, Vite dev on 5173, real `data/` (anonymised CSV plus report, no vector DB state file). Only read-only cases were run against the real backend. Cases that would change real data or need models are marked "Not run" and must be run by hand with `data/` backed up (`docs/qa/ui-fixes-manual-test.md`).

## Step 1: full suite

| Command | Result |
|---|---|
| `.venv/bin/python -m unittest discover tests` | Pass: 166 tests, OK |
| `npm run lint` | Pass: 0 errors, 12 warnings (react-hooks/exhaustive-deps) |
| `npm test` | Pass: 134/134 |
| `npm run check:copy` | Pass: clean |
| `npm run build` | Pass (chunk-size warning only) |
| `npm run e2e` | Pass: 150 passed, 6 skipped (desktop + mobile) |

`logs/llama-server.pid` restored with `git checkout -- logs/llama-server.pid`.

## Step 2: manual cases against the running app

Observed: `GET /api/pipeline/status` reflects the existing data: step 1 `needs_review` (300 rows, 409 removed, 1 to review, by type 288/16/73/32), step 2 `done` (900 documents, from the existing vector DB), steps 3 and 4 `not_started`, step 5 `ready`. `data/pipeline_state.json` was **not** created by reading status (checked after every call and after both restarts).

| Case | Result |
|---|---|
| Stepper and step 1 Done card render from the status (NL) | Pass: amber "1 om na te kijken", four tiles, "Mogelijk gemist (1)" visible, Continue disabled with reason |
| 1.2 Restart keeps checkmarks | Pass: status JSON identical before and after restart except the vectors timestamp (see finding 1); `localStorage` is `{}` in NL and only `nse.lang` after toggling |
| 1.3 / Overview renders | Pass: hero "Laatst bijgewerkt", filters, empty state "Er zijn nog geen samenvattingen" with link to step 4 |
| 5.1 Kill backend, offline banner (pipeline) | Pass: "De analyse-service is niet bereikbaar. Start de app opnieuw." on a fresh load; steps show "Nog niet gedaan" (no last-known state because the page was loaded offline) |
| 5.2 Offline Overview | Pass: same text, no "error" theme, no "0 comments" |
| 5.3 Recovery after restart | Not run: only restart and reload checked; the 5 s auto-retry is covered by e2e only |
| 6 / language toggle on pipeline page, mid-page | Pass: NL to EN switches nav, steps, Done card, review box and dates at once; reload keeps EN; back to NL works |
| 6.1 / 6.2 Toggle during a running step | Not run: would modify real data / needs models, run manually |
| 7.1 Welcome-back banner | Pass: shown on first load with finished work, closable |
| 7.2 Banner not shown again | Not run: not separately checked against the real backend; covered by e2e |
| 7.3 Fresh install | Not run: would move real `data/` away, run manually |
| 1.1 Done card per step 2, 3, 4 after real runs | Not run: would modify real data / needs models, run manually |
| 2.1 to 2.6 Review gate, acknowledge, stale report | Not run: acknowledge POST would modify real data; 2.1 and 2.2 display only observed (pass, see above) |
| 3.1 to 3.3 Skip verification, server 409 on build-vectors, 3.2b blocked report | Not run: would modify real data / needs models, run manually (409 gate covered by unit tests) |
| 4.1 to 4.4 Re-run step 1, stale downstream | Not run: would overwrite real data, run manually |
| 5.4 Stop backend during a step 2 build | Not run: needs models and a build, run manually |

## Step 2b: board screenshots

`npm run e2e` is green. Screenshots in `dashboard/e2e/__screens__/` (git-ignored, not committed). Looked at the Main and Step 4 desktop boards: stepper, banner, Done card with review box, tier cards and results list match the mockup layout. No new layout drift found, nothing changed. Task 18 already did the full side-by-side pass; larger items stay in the final review log.

## Findings

1. Vectors `completed_at` without a state file comes from the mtime of `chroma.sqlite3`, which moved between two backend starts (18:07:28 to 18:08:19). The hero "Laatst bijgewerkt" therefore shifts after a restart until step 2 is run once and the state file records it. Low impact; not fixed here.
2. A page loaded while the backend is offline shows every step as "Nog niet gedaan" (nothing cached). Last-known states only stay if the page was already loaded when the backend went away.
3. `data/pipeline_state.json` is not created by reads (expected).

All processes started (Flask, Vite) were stopped; ports 5001 and 5173 are free.

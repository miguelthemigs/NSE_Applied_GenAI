# UI fixes: manual test script

Run this script before a demo or a release of the UI fixes (spec: `docs/superpowers/specs/2026-10-31-ui-fixes-design.md`). The automated suites (`npm test`, `npm run e2e`) mock the backend. This script checks the real backend, the real files on disk and a real browser.

## Setup

1. Back up `data/` (for example `cp -R data data.bak`). Several checks below change or delete files there.
2. Start the backend from the repository root: `.venv/bin/python app.py`. It serves `http://127.0.0.1:5001`.
3. Start the dashboard: `cd dashboard && npm run dev`. Open `http://localhost:5173/pipeline-demo`.
4. Use a new browser window for each section, so that the once-per-session "welcome back" banner starts from scratch.

Record each check as pass or fail, with a screenshot when it fails.

## 1. Restart the backend after each step: the checkmarks persist

Run steps 1 to 4 in order. After **each** step finishes:

| # | Action | Expected |
|---|---|---|
| 1.1 | Wait for the step's Done card. | Green check, the "Klaar. …" sentence with real numbers, and "Laatst bijgewerkt: {date}". The page does not jump to the next step by itself. |
| 1.2 | Stop the backend (Ctrl+C) and start it again. Reload the page. | The stepper shows the same states as before the restart ("Klaar" for every finished step). The Done card shows the same numbers. Nothing is kept in localStorage: `localStorage` only holds `nse.lang`. |
| 1.3 | Open the Overview (`/`). | The hero shows "Laatst bijgewerkt: {date}", the same time as the latest finished step. |

## 2. Fixture CSV with one known miss: the review gate

Make a small CSV with one open-answer column of about 10 rows. One row contains a name in an unusual spelling or position, such as a lower-case surname after a comma. Run step 1 with the follow-up check switched **on**.

If the first pass catches every name, simulate the miss. Stop the backend. In `data/anonymization_report.json`, set `missed_counts.NAME` to `1` and `missed_samples.NAME` to `["<the name>"]`, and leave `timestamp` unchanged. Start the backend again.

| # | Action | Expected |
|---|---|---|
| 2.1 | Open step 1. | The stepper says "1 om na te kijken" in amber. The Done card shows the four tiles (Namen, Locaties, Persoonlijke nummers, Gezondheid) and the amber box "Mogelijk gemist (1)" with the missed text visible. Nothing has to be expanded to see it. |
| 2.2 | Look at "Verder naar stap 2". | Disabled, with "Vink eerst aan dat je de mogelijke missers hebt bekeken." next to it. Step 2's main button is disabled too, with "Doe eerst stap 1: …". |
| 2.3 | Click "Opnieuw uitvoeren". On the upload screen, look at the existing-dataset card. | Its "Verder naar stap 2" is disabled with the same reason. "Resultaten bekijken" returns to the Done card. |
| 2.4 | Tick "Ik heb de mogelijke missers bekeken". | The box is briefly disabled, then stays ticked. "Verder naar stap 2" becomes enabled. The missed text is **still visible**. |
| 2.5 | Restart the backend and reload. | Step 1 reads "Klaar". The box is ticked and disabled. `data/pipeline_state.json` has `anonymize.acknowledged: true` and `acknowledged_report` equal to the report's `timestamp`. |
| 2.6 | Stale report: open step 1 in two tabs. In tab B, run step 1 again on the same CSV. Then tick the box in tab A (which still shows the old list). | Tab A unticks the box and shows "Er is een nieuwer rapport; bekijk de lijst opnieuw". The list updates to the new report. Continue stays disabled until the box is ticked again. |

## 3. Skip verification: amber, never green

| # | Action | Expected |
|---|---|---|
| 3.1 | Run step 1 with the follow-up check switched **off**. | The Done card is amber, with "Niet gecontroleerd" and "De controle achteraf is overgeslagen …". There is no green check and no "Alles in orde" anywhere on the card. The stepper shows step 1 in amber. |
| 3.2 | Look at "Verder naar stap 2" and at step 2. | Continue is disabled ("Voer eerst de controle uit."). Step 2's main button is disabled, with "Doe eerst stap 1: …". `GET /api/pipeline/status` reports step 2 as `blocked`. `curl -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:5001/api/build-vectors` answers 409 with `code: "error.blocked"` (the same applies while step 1 needs review). |
| 3.2b | While step 1 needs review (section 2), block the request URL `/api/anonymize-report` in Chrome DevTools (Network → right-click → Block request URL) and reload. | The review box shows "De lijst met mogelijke missers kon niet worden geladen." with "Opnieuw proberen". The acknowledge box stays disabled until the list loads. |
| 3.3 | Click "Controle nu uitvoeren". | The progress panel runs the check. The card then shows the checked result: green (no misses) or the review box (misses). |

## 4. Re-run step 1: downstream steps become stale

Precondition: steps 1, 2 and 4 are done (step 3 is done or skipped).

| # | Action | Expected |
|---|---|---|
| 4.1 | Open step 1, click "Opnieuw uitvoeren" and run it again (tick the review box if it asks). | Step 1 shows its new Done card. |
| 4.2 | Look at the stepper. | Step 2 reads "Bijwerken nodig" (amber, update icon). Steps 3 and 4 follow from step 2's new time once step 2 is rebuilt. |
| 4.3 | Open step 2. | Its Done card is amber with "Bijwerken nodig" and an explanation. "Opnieuw uitvoeren" opens the settings. "Verder naar stap 3" still works, because stale data can be used. |
| 4.4 | Open the Overview. | The summaries are still there. The cache is only cleared after a rebuild **succeeds**. |

## 5. Kill the backend: offline message

| # | Action | Expected |
|---|---|---|
| 5.1 | With the pipeline page open, stop the backend. Wait about 5 s. | A red banner: "De analyse-service is niet bereikbaar. Start de app opnieuw." The steps and the last known states stay on screen. There is no blank page and no "NaN". |
| 5.2 | Open the Overview. | The same offline text. No "error" theme and no "0 comments". |
| 5.3 | Start the backend again. Wait about 5 s. | The pipeline page recovers by itself (it retries every 5 s) and the banner disappears. |
| 5.4 | Stop the backend **during** a step 2 build. | The progress panel stops and the step shows "Niet gelukt", with the raw message only behind "Details tonen". After a restart, step 2 offers to resume ("Onderbroken, je kunt verdergaan"). |

## 6. Toggle the language mid-run

| # | Action | Expected |
|---|---|---|
| 6.1 | Start step 2 (or step 4). While the progress panel runs, switch NL → EN with the toggle in the navigation bar. | The run continues and is not restarted. The stage label, percentage text, step names and buttons switch to English at once. The raw log lines (behind "Show details") stay in the backend's language. |
| 6.2 | Let the run finish. | The Done card is in English ("Done. … answers are ready for search (Balanced model)."). |
| 6.3 | Reload. | The language is still English (`localStorage['nse.lang'] = 'en'`). |
| 6.4 | Switch back to NL while the Done card of step 1 shows the review box. | The box title becomes "Mogelijk gemist (n)". The tick state does not change. |

## 7. Welcome-back banner

| # | Action | Expected |
|---|---|---|
| 7.1 | With at least one finished step, open `/pipeline-demo` in a new window. | A blue banner: "Welkom terug. Je eerdere werk is bewaard (laatst bijgewerkt {date})." It can be closed with the close button. |
| 7.2 | Reload, or go to the Overview and back. | The banner does not show again in this window (`sessionStorage['nse.welcomed']`). |
| 7.3 | Fresh install (rename `data/` away and restart the backend). | No banner and no "Laatst bijgewerkt" line. |

## Cleanup

Stop both servers and restore `data/` from the backup.

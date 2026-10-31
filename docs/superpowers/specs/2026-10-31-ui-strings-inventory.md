# UI string inventory: current text → NL / EN

Line numbers are as of commit `6a48c37`. "(Done card)" and "(one-liner)" refer to keys in the spec. "(Details only)" means the text moves behind "Show details". "(drop)" means delete it.

## Pipeline page

| file:line | Current | NL | EN |
|---|---|---|---|
| PipelineDemo.jsx:45 | Data Pipeline | Analyse in 5 stappen | Analysis in 5 steps |
| PipelineDemo.jsx:47 | Securely anonymize feedback, vectorize the text, and query using AI. | `page.lead` | `page.lead` |
| PipelineDemo.jsx:52 | Processing in backend... | Bezig… | In progress… |
| PipelineDemo.jsx:32-36 | 1. Anonymize Data … 5. AI Query | `step.*` | `step.*` |
| AnonymizerTab:329-330 | Data Anonymization Engine / Transform sensitive survey data… | `step.anonymize` / `.lead` | same |
| AnonymizerTab:358 | Onderbroken anonimisering gevonden | Je vorige keer is niet afgemaakt | Your last run didn't finish |
| AnonymizerTab:360-361 | {x} van {y} kolom(men) al klaar — gestopt bij "col" | {x} van {y} kolommen klaar, gestopt bij "{col}" | {x} of {y} columns done, stopped at "{col}" |
| AnonymizerTab:363 | Je kunt verdergaan zonder opnieuw te beginnen. | Je kunt verdergaan waar je was. | You can pick up where you left off. |
| AnonymizerTab:371 / VectorDBBuilder:204 | Negeren | Opnieuw beginnen | Start over |
| AnonymizerTab:377 / VectorDBBuilder:210 | Verdergaan | Verdergaan | Resume |
| AnonymizerTab:390-391 | Vorige run beschikbaar / {ts} — {n} rijen, {m} entiteiten verwijderd | Eerder resultaat beschikbaar / {date} · {n} antwoorden, {m} persoonsgegevens verwijderd | Earlier result available / {date} · {n} answers, {m} personal details removed |
| AnonymizerTab:398 | Bekijk resultaten | Resultaten bekijken | View results |
| AnonymizerTab:419-420 | Drop your CSV file here or click to browse / Supports .csv and .xlsx files | Sleep je bestand hierheen of klik om te kiezen / CSV- of Excel-bestand (.csv, .xlsx) | Drag your file here or click to choose / CSV or Excel file (.csv, .xlsx) |
| AnonymizerTab:432 | Er is al een geanonimiseerde dataset beschikbaar. | (Done card) | (Done card) |
| AnonymizerTab:440 | Bezig... / Check uitvoeren | Bezig… / Opnieuw controleren | Checking… / Check again |
| AnonymizerTab:446 | Overslaan | `action.continue` | `action.continue` |
| AnonymizerTab:470 | What gets masked | Wat wordt verwijderd | What gets removed |
| AnonymizerTab:140-144, 825-829 | Names / persons, Addresses / locations, Identifiers…, Titles, Health info… | Namen · Adressen en locaties · Persoonlijke nummers (e-mail, telefoon, BSN, studentnummer) · Aanspreekvormen · Gezondheid | Names · Addresses and locations · Personal numbers (email, phone, BSN, student no.) · Forms of address · Health |
| AnonymizerTab:484 | Selected layers replace detected entities… | Gevonden gegevens worden vervangen door een label, zoals [NAAM]. | Found details are replaced by a label, such as [NAME]. |
| AnonymizerTab:491 | Select Columns | Welke kolommen bevatten open antwoorden? | Which columns contain open answers? |
| AnonymizerTab:522 | Choose Layers | Grondigheid (Geavanceerd) | Thoroughness (Advanced) |
| AnonymizerTab:150-174 | Layer 1: Presidio… / Fast / Recommended / Deep | Snel / Aanbevolen / Grondig | Quick / Recommended / Thorough |
| AnonymizerTab:594 | Recommended uses … privacy_officer … spans… | (drop) | (drop) |
| AnonymizerTab:604, 614, 623, 656 | Custom Word Filter / Words or phrases added here… / Type a word… / No custom words added yet. | Woorden die altijd weg moeten / Deze woorden worden altijd verwijderd, ook als de AI ze mist. / Typ een woord en druk op Enter / Nog geen woorden toegevoegd. | Words to always remove / These words are always removed, even if the AI misses them. / Type a word and press Enter / No words added yet. |
| AnonymizerTab:662 | Dataset Preview (Row 1) | Voorbeeld (eerste antwoord) | Preview (first answer) |
| AnonymizerTab:684 | Go Back | Terug | Back |
| AnonymizerTab:694 | Verify: On/Off | Controle achteraf: aan/uit | Check afterwards: on/off |
| AnonymizerTab:705, 707 | Initializing Models... / Launch Anonymization Engine 🚀 | Model wordt gestart… / Persoonsgegevens verwijderen | Starting the model… / Remove personal details |
| AnonymizerTab:738 | Processing Stream / Anonymization Complete | `state.in_progress` / (Done card) | same |
| AnonymizerTab:762 | Live Data Feed | (Details only) | (Details only) |
| AnonymizerTab:772 | Checkpoint opgeslagen — {row} | Tussenstand bewaard | Progress saved |
| AnonymizerTab:781/785/789 | Models Loaded / Analyzing Text / Selected Layers Applied | `stage.*` | `stage.*` |
| AnonymizerTab:800 | Anonymization Failed | Verwijderen is niet gelukt | Removing details didn't finish |
| AnonymizerTab:812 | Anonymized Masks / Anonymization Verification | Controle van de resultaten | Results check |
| AnonymizerTab:816/818/819 | Verification skipped / All clear ✓ / ⚠ Possible leaks | `state.unverified` / Alles in orde / `state.needs_review` | same |
| AnonymizerTab:868/876/889 | {n} mask(s) / {n} removed / {n} possibly missed | {n} verwijderd / {n} mogelijk gemist | {n} removed / {n} possibly missed |
| AnonymizerTab:897 | None detected | Niets gevonden | None found |
| AnonymizerTab:906/926 | Removed — {n} unique / Possibly missed — {n} unique | Verwijderd ({n} verschillende) / Mogelijk gemist ({n}) | Removed ({n} different) / Possibly missed ({n}) |
| AnonymizerTab:917/937 | No sample data — restart the backend… | Geen voorbeelden beschikbaar. | No examples available. |
| AnonymizerTab:950/954 | Scanned/Checked {cells} cells — {n} entities… | {cells} cellen gecontroleerd, {n} persoonsgegevens verwijderd. | {cells} cells checked, {n} personal details removed. |
| AnonymizerTab:245/250 | Select at least one column / …layer | Kies minstens één kolom. | Choose at least one column. |
| VectorDBBuilder:174-175 | Semantic Vector Database / Configure and build… | `step.vectors` / `.lead` | same |
| VectorDBBuilder:191-193 | Onderbroken vector build gevonden / documenten al geïndexeerd | Je vorige keer is niet afgemaakt: {x} van {y} antwoorden klaar | Your last run didn't finish: {x} of {y} answers done |
| VectorDBBuilder:231/234/256 | Columns to Vectorize / {n} rows / {x} of {y} columns selected | Welke kolommen? / {n} antwoorden / {x} van {y} kolommen gekozen | Which columns? / {n} answers / {x} of {y} columns chosen |
| VectorDBBuilder:253 | Loading columns... / Unavailable | Kolommen laden… / Niet beschikbaar | Loading columns… / Not available |
| VectorDBBuilder:74 | Could not connect to the backend. Is the Flask server running? | `overview.offline` | `overview.offline` |
| VectorDBBuilder:263/303 | Embedding Model / Choose between compact… | Hoe grondig? | How thorough? |
| VectorDBBuilder:278 / InsightGenerator:346 | Default | Aanbevolen | Recommended |
| VectorDBBuilder:294-295 | ⚡ Fastest Octen / 🌍 Multilingual | (drop) | (drop) |
| VectorDBBuilder:315-317 | Download model if missing / …ChromaDB… | Model downloaden als het ontbreekt (Geavanceerd) | Download model if missing (Advanced) |
| VectorDBBuilder:325 | {n} columns × {r} rows → model | {r} antwoorden · model: {tier} | {r} answers · {tier} model |
| VectorDBBuilder:332 | Launch Vector Builder 🚀 | Antwoorden doorzoekbaar maken | Prepare answers |
| VectorDBBuilder:360/375/386 | Building Vector Embeddings / System Status / Live Encoding Stream | `state.in_progress` / (Details only) | same |
| VectorDBBuilder:404 | Load Model / Read Data / Encode Vectors / Save to DB | `stage.*` | `stage.*` |
| VectorDBBuilder:434/437 | Knowledge Base Ready / Successfully processed… | (Done card) / Niet gelukt: {reason} | (Done card) / Didn't finish: {reason} |
| VectorDBBuilder:443/447/451 | Documents Indexed / Vectors Created / Model Used | Antwoorden / (drop) / Model | Answers / (drop) / Model |
| ThemeReranker:99-100 | Theme Reranker / Resolve embedding-ambiguous rows… | `step.rerank` / `.lead` | same |
| ThemeReranker:108 | Build the vector database before running the reranker stage. | `gate.reason` | `gate.reason` |
| ThemeReranker:115-124 | Vector DB / Ready / Reranker Status / not_run / Current Model / disabled | (drop; stepper) / Status: `state.*` / (Advanced) / Uitgeschakeld | (drop) / Status: `state.*` / (Advanced) / Switched off |
| ThemeReranker:131 | Reranker model (raw ID input) | Advanced only | Advanced only |
| ThemeReranker:154/158 | Max documents / All ambiguous rows | Maximaal aantal antwoorden / Alle twijfelgevallen | Maximum answers / All unclear answers |
| ThemeReranker:167 | Embedding-confident rows stay assigned… | {n} antwoorden twijfelen tussen thema's en worden opnieuw gelezen. | {n} answers could fit more than one theme and will be re-read. |
| ThemeReranker:174/187 | Run Reranker / Resolving Theme Assignments | Thema's controleren / `state.in_progress` | Double-check themes / `state.in_progress` |
| ThemeReranker:201/204 | Final Theme Assignments Ready / Reranker Failed | (Done card) / Controleren is niet gelukt | (Done card) / The check didn't finish |
| ThemeReranker:210-222 | Reranked / Changed / Low Info / Model | Opnieuw gelezen / Ander thema / Zonder inhoud / (Advanced) | Re-read / New theme / No real content / (Advanced) |
| InsightGenerator:310-311 | AI Insight Generation / Run a local LLM… | `step.insights` / `.lead` | same |
| InsightGenerator:325 | llama.cpp Model | Hoe grondig? | How thorough? |
| InsightGenerator:144/152/172 | Selected… / Starting {m} with llama.cpp… / …ready on llama.cpp. | Gekozen. / Model wordt gestart… / Model staat klaar. | Selected. / Starting the model… / Model is ready. |
| InsightGenerator:375 | Selecting a model starts llama-server… | (drop) | (drop) |
| InsightGenerator:385 | Options | Geavanceerd | Advanced |
| InsightGenerator:392-393 | Clear Cached Insights / Force regeneration… | `insights.clearCache` | `insights.clearCache` |
| InsightGenerator:408-409 | Start llama-server if needed / …Hugging Face… | Model automatisch starten / De eerste keer wordt het model gedownload. | Start the model automatically / The model downloads the first time. |
| InsightGenerator:415-420 | Pre-cache filtered insights / Cross-product… | `insights.filtered` | `insights.filtered` |
| InsightGenerator:424-428 | Academic Year / Location / Programme / Study Mode / Language | Studiejaar / Locatie / Opleiding / Studievorm / Taal | Academic year / Location / Programme / Study mode / Language |
| InsightGenerator:462-466 | {n} combos × 7 themes = {m} theme insights / ~{min} min | {m} samenvattingen, ongeveer {min} min | {m} summaries, about {min} min |
| InsightGenerator:474/487-491 | Documents analysed per theme / 60 (fast) / 240 (default) / Higher = more accurate… | Antwoorden per thema / 60 (snel) / 240 (standaard) / alle / Meer = nauwkeuriger, maar trager. | Answers per theme / 60 (fast) / 240 (default) / all / More = more accurate, but slower. |
| InsightGenerator:514 | Cache will be cleared | Opgeslagen samenvattingen worden gewist | Saved summaries will be cleared |
| InsightGenerator:525-576 | four generate buttons + subtitles | `insights.run` + results rows | same |
| InsightGenerator:612/622 | Generating AI Insights / Generation stopped / via llama.cpp | `state.in_progress` / Gestopt / (drop) | `state.in_progress` / Stopped / (drop) |
| InsightGenerator:288/291 | 🔄 Stream stopped, resuming… / ❌ Max retries reached… | Verbinding even weg, we proberen het opnieuw… / Niet alle thema's zijn gelukt. Probeer het opnieuw. | Connection lost, retrying… / Some themes didn't finish. Try again. |
| InsightGenerator:643 | ← Back to settings | Terug naar instellingen | Back to settings |
| InsightGenerator:659-665 | {label} Generated Successfully / … / Model used | (Done card) | (Done card) |
| QueryTab:95-96 | ✨ Query Vector Database / Ask natural language questions… | `step.query` / `.lead` | same |
| QueryTab:105/109 | Your Question / e.g., What do students say about the teaching quality? | Je vraag / Bijv. Wat zeggen studenten over de kwaliteit van het onderwijs? | Your question / e.g. What do students say about teaching quality? |
| QueryTab:118/130 | 🔍 Filters (optional) / All | Filters (optioneel) / Alle | Filters (optional) / All |
| QueryTab:123-203 | Institution / Academic Year / Location / Programme / Study Mode / Cohort | Instelling / Studiejaar / Locatie / Opleiding / Studievorm / Cohort | Institution / Academic year / Location / Programme / Study mode / Cohort |
| QueryTab:~226-261 | Searching... / Search Database / ❌ Error: / 📊 Results for "q" / No results found… / Match: {x}% | Zoeken… / Zoeken / Zoeken is niet gelukt: / {n} antwoorden bij "{q}" / Geen antwoorden gevonden. Probeer andere woorden of minder filters. / Overeenkomst {x}% | Searching… / Search / Search didn't work: / {n} answers for "{q}" / No answers found. Try other words or fewer filters. / Match {x}% |

## Elsewhere

| file:line | Current | NL | EN |
|---|---|---|---|
| NavBar.jsx:7-8 | Overview / Pipeline | Overzicht / Analyse | Overview / Analysis |
| HeroBanner.jsx:90/98 | Student Survey Dashboard / NSE Insights Overview | Studentenenquête / NSE Insights overzicht | Student survey / NSE Insights overview |
| HeroBanner.jsx:106 | Explore student open answers organized into {n} themes… | Open antwoorden van studenten, ingedeeld in {n} thema's en samengevat door AI. | Students' open answers, grouped into {n} themes and summarised by AI. |
| HeroBanner.jsx:116-151 | Comments / Themes / Sub-themes / Top Theme | Reacties / Thema's / Subthema's / Grootste thema | Comments / Themes / Sub-themes / Largest theme |
| Overview.jsx:~205/~222 | Clear all filters / Theme Frequency Insights | Alle filters wissen / Thema's op volgorde van aantal reacties | Clear all filters / Themes by number of comments |
| Overview.jsx:~230 | Loading real theme data | Thema's laden… | Loading themes… |
| Overview.jsx:~240-243 | No responses match this filter combination / Try removing one filter… | Geen reacties bij deze filters / Haal een filter weg of wis alles. | No comments match these filters / Remove a filter or clear all. |
| Overview.jsx:~256-259 | No real theme insights available / Run insight generation… | `overview.empty` / `.emptyAction` | same |

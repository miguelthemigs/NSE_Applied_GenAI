LOW_INFORMATION_THEME = "No Meaningful Response"
THEME_TAXONOMY_VERSION = 1
THEME_CLASSIFICATION_VERSION = 2

THEME_RETRIEVAL_PROMPT = (
    "Instruct: Given an educational feedback category, retrieve Dutch, English, "
    "or German student survey responses whose primary topic matches that category. "
    "Focus on the main issue being evaluated, not incidental words or secondary topics.\n"
    "Query: "
)

THEMES_LIST = [
    "Content and Organisation",
    "Professional Practice",
    "Teachers",
    "Support / Mentoring",
    "Examination & Assessment",
    "Engagement & Contact",
    "Special Circumstances",
    LOW_INFORMATION_THEME,
]

THEME_LLM_DEFINITIONS = {

    "Content and Organisation": (
        "Comments about the academic content, curriculum design, and programme-level structure "
        "of the course programme. This includes the relevance of programme content to current "
        "professional or academic developments, the quality and usefulness of study materials, "
        "the academic level and challenge of the programme, and the learning methods built into "
        "the curriculum. It also includes opportunities to broaden, deepen, or personalise knowledge "
        "and skills, alignment and progression between curriculum components, repetition or gaps "
        "between modules, and the overall amount and distribution of academic pressure and workload. "
        "Learning methods here refer to programme-level formats such as lectures, projects, group "
        "work, practical activities, and self-study."
    ),

    "Professional Practice": (
        "Comments about how well the course programme prepares students for professional practice "
        "and connects them with the professional field. This includes opportunities to develop and "
        "practise professional skills, apply knowledge in realistic work situations, and prepare for "
        "future employment or professional careers. It also includes internships, work placements, "
        "guest speakers, company visits, networking opportunities, assignments for external "
        "organisations, contact with professionals, and whether the programme reflects current "
        "professional expectations and workplace practices."
    ),

    "Teachers": (
        "Comments about the qualities, behaviour, expertise, and teaching performance of teachers. "
        "This includes whether teachers care about students, have strong didactic skills, possess "
        "sufficient subject-matter expertise, and understand the relevant professional practice. "
        "It also includes teachers' ability to explain concepts and instructions clearly, teach "
        "clearly in English, inspire and motivate students, support students with learning and "
        "academic work, and create a respectful and safe environment in which students feel "
        "comfortable asking questions and making mistakes. Teacher support here refers to support "
        "provided as part of the teacher's normal teaching role."
    ),

    "Support / Mentoring": (
        "Comments about guidance, counselling, coaching, or advisory support provided outside "
        "teachers' normal guidance on course content and academic work. This includes support from "
        "mentors, counsellors, coaches, study advisors, student advisors, career advisors, and "
        "similar support roles. It covers the availability and accessibility of guidance, knowing "
        "where and how to request support, waiting times or difficulty arranging appointments, and "
        "the quality, consistency, relevance, and usefulness of the advice provided. It also includes "
        "help with study planning, academic progress, study choices, personal development, career "
        "orientation, and general difficulties that affect study progress."
    ),

    "Examination & Assessment": (
        "Comments about how students' knowledge, understanding, and skills are examined, assessed, "
        "judged, or graded. This includes the alignment between assessments and the content taught "
        "in the programme, the clarity and consistency of assessment criteria, rubrics, instructions, "
        "and performance expectations, and the quality and difficulty of theoretical and practical "
        "examinations. It also includes the suitability of assessment methods such as written exams, "
        "presentations, projects, portfolios, reports, and practical demonstrations. Feedback in this "
        "theme refers to feedback on assignments, examinations, reports, or other assessed work, "
        "including whether it is clear, useful, timely, and helps students understand their performance "
        "and how to improve it."
    ),

    "Engagement & Contact": (
        "Comments about students' contact with teachers, involvement in learning, sense of safety "
        "and belonging, motivation to participate, and whether student opinions are welcomed and "
        "valued. This includes whether students can reach teachers when needed, whether feedback on "
        "their work helps them understand course materials, and whether they feel safe to be themselves "
        "within the programme. It also includes feeling accepted and connected to the programme "
        "community, feeling inspired by what is being learned, regularly preparing for classes and "
        "working with course materials, reflecting on or applying learning outside class, and taking "
        "part in activities beyond normal lessons and assignments. Student voice includes whether "
        "teachers and the programme value student feedback and provide meaningful channels such as "
        "evaluations, consultations, or student panels."
    ),

    "Special Circumstances": (
        "Comments about studying while personal, medical, financial, family-related, accessibility, "
        "or other exceptional circumstances affect a student's ability to participate in or complete "
        "their studies. This includes difficulties involving concentration, energy, sensitivity to "
        "stimuli, planning and organisation, social interaction, reading, writing, mathematics, "
        "stress, finances, transport, housing, caring responsibilities, family situations, "
        "entrepreneurship, top-level sport, work, internships, or health-related circumstances. "
        "It also includes the effect of mandatory attendance, fixed schedules, examinations, physical "
        "or digital environments, websites, learning platforms, and learning materials on students "
        "with special circumstances. The theme covers whether students know who to contact, how to "
        "notify the institution, barriers to disclosure, meetings and information after disclosure, "
        "accommodations or alternative arrangements, accessibility, and whether the institution is "
        "understanding and able to respond appropriately. A health condition may appear as '[health]'. "
        "Treat '[health]' only as a redacted health-related circumstance and do not infer or reconstruct "
        "the specific condition."
    )

}

THEME_EMBEDDING_DEFINITIONS = {

    "Content and Organisation": (
        "Feedback over de academische inhoud, opbouw en organisatie van het curriculum. "
        "De kern is wat studenten leren, hoe onderdelen van de opleiding samenhangen en "
        "of het programma voldoende relevant, uitdagend, coherent en studeerbaar is. "
        "Onderwerpen: inhoud opleiding, curriculum, vakken, modules, academisch niveau, "
        "uitdaging, studiemateriaal, onderwijsmethoden, leermethoden, samenhang, opbouw, "
        "doorlopende leerlijn, overlap, herhaling, ontbrekende inhoud, verdieping, verbreding, "
        "keuzevrijheid, personalisering, studielast, werkdruk, academische druk. "
        "English terms: curriculum content, programme structure, academic level, study materials, "
        "curriculum coherence, workload, academic pressure. "
        "German terms: Studieninhalt, Studienaufbau, Lehrmaterial, akademisches Niveau, "
        "Abstimmung der Module, Arbeitsbelastung, Studiendruck."
    ),

    "Professional Practice": (
        "Feedback over hoe de opleiding studenten voorbereidt op het beroep en hen in contact "
        "brengt met de beroepspraktijk. De kern is het ontwikkelen van professionele vaardigheden, "
        "praktijkervaring en aansluiting op toekomstig werk. "
        "Onderwerpen: beroepspraktijk, werkveld, beroepsvaardigheden, praktische vaardigheden, "
        "beroepsvoorbereiding, loopbaanvoorbereiding, carrière, stage, werkplekleren, praktijkervaring, "
        "externe opdrachtgever, bedrijfsopdracht, project voor bedrijf, gastspreker, bedrijfsbezoek, "
        "netwerken, contact met professionals, aansluiting arbeidsmarkt. "
        "English terms: professional practice, career readiness, professional skills, internship, "
        "work placement, external project, contact with professionals. "
        "German terms: Berufspraxis, Berufsvorbereitung, berufliche Fähigkeiten, Praktikum, "
        "Praxisprojekt, Unternehmenskontakt."
    ),

    "Teachers": (
        "Feedback over docenten en hun functioneren in hun onderwijsrol. De kern is hoe docenten "
        "lesgeven, uitleggen, studenten behandelen en hun vak- en praktijkkennis inzetten. "
        "Onderwerpen: docent, leraar, lesgever, didactische vaardigheden, pedagogische vaardigheden, "
        "vakkennis, deskundigheid, praktijkkennis, duidelijke uitleg, instructies, lesgeven in Engels, "
        "betrokken docent, zorg voor studenten, inspirerend lesgeven, ondersteuning tijdens de les, "
        "veilig vragen stellen, respectvol gedrag, sfeer in de klas. "
        "English terms: teacher quality, teaching skills, didactic skills, subject expertise, "
        "clear explanations, inspiring teacher, classroom support, safe learning environment. "
        "German terms: Lehrkraft, Lehrqualität, didaktische Fähigkeiten, Fachwissen, "
        "verständliche Erklärung, Unterstützung im Unterricht."
    ),

    "Support / Mentoring": (
        "Feedback over begeleiding, coaching, counselling en advies buiten de gewone vakinhoudelijke "
        "begeleiding door docenten. De kern is of studenten passende begeleiding kunnen krijgen en "
        "hoe bruikbaar en toegankelijk deze begeleiding is. "
        "Onderwerpen: begeleiding, mentoring, mentor, coach, counsellor, studieadviseur, studentadviseur, "
        "decaan, studieloopbaanbegeleider, SLB, loopbaanadviseur, afspraak, beschikbaarheid begeleiding, "
        "wachttijd, advies, studieplanning, studievoortgang, studiekeuze, persoonlijke ontwikkeling, "
        "loopbaanadvies, hulp bij studieproblemen. "
        "English terms: mentoring, counselling, coaching, study advisor, student support, "
        "study planning, academic progress, career advice. "
        "German terms: Betreuung, Mentoring, Beratung, Studienberatung, Coaching, Studienplanung, "
        "Unterstützung beim Studienfortschritt."
    ),

    "Examination & Assessment": (
        "Feedback over toetsing, examinering, beoordeling en feedback op beoordeeld werk. "
        "De kern is hoe kennis en vaardigheden worden getoetst, beoordeeld en van een cijfer "
        "of beoordeling worden voorzien. "
        "Onderwerpen: toets, tentamen, examen, assessment, opdracht, beoordeling, cijfer, nakijken, "
        "beoordelingscriteria, rubric, toetscriteria, toetsinstructies, theoretische toets, praktische toets, "
        "toetsvorm, toetsmethode, aansluiting toets en lesstof, moeilijkheid toets, eerlijke beoordeling, "
        "consistente beoordeling, herkansing, toetsplanning, feedback op tentamen, feedback op opdracht, "
        "feedback op verslag, feedback op beoordeeld werk. "
        "English terms: examination, assessment, grading, assessment criteria, rubric, exam quality, "
        "assessment alignment, feedback on assessed work. "
        "German terms: Prüfung, Bewertung, Benotung, Bewertungskriterien, Prüfungsform, "
        "Prüfungsqualität, Feedback zu bewerteten Leistungen."
    ),

    "Engagement & Contact": (
        "Feedback over contact, betrokkenheid, motivatie, participatie, verbondenheid en inspraak "
        "binnen de opleiding. De kern is of studenten zich bereikbaar, betrokken, gehoord en onderdeel "
        "van de opleidingsgemeenschap voelen. "
        "Onderwerpen: contact met docent, docent bereiken, bereikbaarheid docent, reactie op bericht, "
        "communicatie met docent, betrokkenheid, motivatie, inspiratie door leren, actief leren, "
        "voorbereiden op les, werken met lesmateriaal, oefenen, reflecteren, toepassen buiten de les, "
        "participatie, je veilig voelen om jezelf te zijn, erbij horen, verbondenheid, sense of belonging, "
        "studentenfeedback, studentinspraak, gehoord worden, feedback wordt gewaardeerd, evaluatie, "
        "studentenpanel, consultatie. "
        "English terms: teacher contact, student engagement, participation, belonging, motivation, "
        "student voice, student feedback is valued. "
        "German terms: Kontakt zu Lehrkräften, studentisches Engagement, Teilnahme, Motivation, "
        "Zugehörigkeitsgefühl, Mitbestimmung, Studierendenfeedback."
    ),

    "Special Circumstances": (
        "Feedback over persoonlijke of bijzondere omstandigheden die het studeren beïnvloeden en "
        "over hoe de instelling deze omstandigheden ondersteunt of faciliteert. De kern is de relatie "
        "tussen de omstandigheid van de student, de gevolgen voor de studie en de reactie van de instelling. "
        "De tag [health] staat voor verwijderde gezondheidsinformatie en moet worden behandeld als een "
        "gezondheidsgerelateerde bijzondere omstandigheid zonder de aandoening te reconstrueren. "
        "Onderwerpen: [health], bijzondere omstandigheden, persoonlijke omstandigheden, concentratie, "
        "energie, prikkelgevoeligheid, lezen, schrijven, rekenen, stress, financiën, geldproblemen, vervoer, "
        "huisvesting, gezinssituatie, mantelzorg, zorgtaak, ondernemerschap, topsport, werk naast studie, "
        "stageverplichting, aanwezigheidsplicht, vast rooster, toegankelijkheid, fysieke toegankelijkheid, "
        "digitale toegankelijkheid, online toegankelijkheid, voorziening, aanpassing, accommodatie, "
        "alternatieve regeling, omstandigheden melden, ondersteuning aanvragen, discriminatie, vooroordeel, "
        "begrip van instelling, informatie na melding. "
        "English terms: special circumstances, health-related circumstances, disability, accessibility, "
        "financial circumstances, caring responsibilities, disclosure, accommodation, institutional support. "
        "German terms: besondere Studienumstände, gesundheitliche Umstände, Barrierefreiheit, "
        "finanzielle Belastung, Betreuungspflichten, Nachteilsausgleich, Unterstützung."
    )

}

METADATA_COLS = {
    "ID",
    "Institution",
    "academic_year",
    "location",
    "programme",
    "study_mode",
    "cohort",
    "Jaar",
    "Actuele BRIN-code volgens RIO",
    "Actuele naam instelling volgens RIO",
    "Actuele CROHO-code volgens RIO",
    "Actuele Opleidingsnaam volgens RIO",
    "Actuele BRIN-volgnummer volgens RIO",
    "Type Student",
    "Opleidingsvorm (vt dt du)",
    "Leerroute_Track",
    "Studiejaar volgens instelling",
    "Kunstopleiding",
    "Afstandsonderwijs",
    "Label1",
    "Label2",
    "Label3",
    "Label4",
    "Label5",
    "Label6",
    "Label7",
}

METADATA_ALIASES = {
    "institution": ["institution", "actuele naam instelling volgens rio"],
    "academic_year": ["academic_year", "jaar"],
    "location": ["location", "actuele brin-volgnummer volgens rio"],
    "programme": ["programme", "leerroute_track", "actuele opleidingsnaam volgens rio"],
    "study_mode": ["study_mode", "Type Student", "Opleidingsvorm (vt dt du)"],
    "cohort": ["cohort", "studiejaar volgens instelling"],
    "sector": ["sector", "Label3"],
    "language": ["language", "Label5"],
}

SOURCE_METADATA_ALIASES = {
    "institution": [
        "Institution",
        "Actuele naam instelling volgens RIO",
    ],
    "academic_year": [
        "academic_year",
        "Jaar",
    ],
    "location": [
        "location",
        "Actuele BRIN-volgnummer volgens RIO",
    ],
    "programme": [
        "programme",
        "Leerroute_Track",
        "Actuele Opleidingsnaam volgens RIO",
    ],
    "study_mode": [
        "Opleidingsvorm (vt dt du)",
        "study_mode",
    ],
    "cohort": [
        "cohort",
        "Studiejaar volgens instelling",
    ],
    "sector": [
        "Label3",
    ],
    "language": [
        "Label5",
    ],
}

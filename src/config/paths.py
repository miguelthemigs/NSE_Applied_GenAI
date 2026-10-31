from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
TEMP_DIR = ROOT_DIR / "temp"

UPLOAD_FILE = DATA_DIR / "temp_upload.csv"
UPLOAD_INFO_FILE = DATA_DIR / "upload_info.json"
ANONYMIZED_CSV_PATH = DATA_DIR / "anonymized_survey.csv"
SEP_FILE = DATA_DIR / "detected_sep.txt"
VECTOR_DB_PATH = ROOT_DIR / "survey_vector_db"
CACHE_FILE = ROOT_DIR / "gemma_cache.json"
SUBTHEME_CACHE_FILE = ROOT_DIR / "gemma_subtheme_cache.json"

ANON_CHECKPOINT_CSV = DATA_DIR / "anon_checkpoint.csv"
ANON_CHECKPOINT_META = DATA_DIR / "anon_checkpoint_meta.json"
ANON_REPORT_FILE = DATA_DIR / "anonymization_report.txt"
ANON_REPORT_JSON = DATA_DIR / "anonymization_report.json"
WORD_BLOCKLIST_PATH = DATA_DIR / "word_blocklist.json"
VECTOR_CHECKPOINT = DATA_DIR / "vector_checkpoint.json"
PIPELINE_STATE_FILE = DATA_DIR / "pipeline_state.json"

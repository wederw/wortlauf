import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.environ.get("WORTLAUF_DATA", ROOT / "data"))
PLUGIN_DIR = Path(os.environ.get("WORTLAUF_PLUGINS", ROOT / "plugins"))
DIST_DIR = Path(os.environ.get("WORTLAUF_DIST", ROOT / "frontend" / "dist"))
MAX_UPLOAD_MB = int(os.environ.get("WORTLAUF_MAX_UPLOAD_MB", "200"))
SESSION_DAYS = int(os.environ.get("WORTLAUF_SESSION_DAYS", "30"))
# "auto" sets the Secure flag whenever the request arrived over HTTPS.
COOKIE_SECURE = os.environ.get("WORTLAUF_COOKIE_SECURE", "auto").lower()

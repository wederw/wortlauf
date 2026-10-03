import json
import mimetypes
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from . import auth
from .config import DATA_DIR, DIST_DIR, MAX_UPLOAD_MB, PLUGIN_DIR
from .db import db, init
from .extract import ExtractError, extract


# Python's table lacks these on some systems; module workers refuse a wrong type.
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("font/woff2", ".woff2")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init()
    (DATA_DIR / "books").mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Wortlauf", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2000)

PAGE_CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; "
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
)
# The script engine worker may load plugin modules from this server and nothing else:
# no fetch, no sockets, no cross-origin imports.
ENGINE_CSP = "default-src 'none'; script-src 'self'"


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "Fremde Herkunft abgelehnt."}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


def user_exists() -> bool:
    with db() as con:
        return con.execute("SELECT 1 FROM user").fetchone() is not None


# ---------------------------------------------------------------- account

class Credentials(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=500)


class Login(BaseModel):
    name: str = Field(max_length=80)
    password: str = Field(max_length=500)


class PasswordChange(BaseModel):
    old: str = Field(max_length=500)
    new: str = Field(min_length=8, max_length=500)


@app.get("/api/state")
def state(request: Request):
    authed = auth.is_authenticated(request)
    name = None
    if authed:
        with db() as con:
            name = con.execute("SELECT name FROM user").fetchone()["name"]
    return {"setupNeeded": not user_exists(), "authenticated": authed, "user": name}


@app.post("/api/setup")
def setup(body: Credentials, request: Request, response: Response):
    with db() as con:
        if con.execute("SELECT 1 FROM user").fetchone():
            raise HTTPException(409, "Es gibt bereits ein Konto.")
        con.execute(
            "INSERT INTO user(id, name, pw_hash) VALUES(1, ?, ?)",
            (body.name.strip(), auth.hash_password(body.password)),
        )
    auth.start_session(request, response)
    return {"ok": True}


@app.post("/api/login")
def login(body: Login, request: Request, response: Response):
    auth.check_throttle()
    with db() as con:
        row = con.execute("SELECT name, pw_hash FROM user").fetchone()
    valid = bool(row) and auth.verify_password(row["pw_hash"], body.password)
    valid = valid and row["name"].lower() == body.name.strip().lower()
    auth.record_login(valid)
    if not valid:
        raise HTTPException(401, "Name oder Passwort stimmt nicht.")
    auth.start_session(request, response)
    return {"ok": True}


@app.post("/api/logout")
def logout(request: Request, response: Response):
    auth.end_session(request, response)
    return {"ok": True}


@app.post("/api/password", dependencies=[Depends(auth.require_user)])
def change_password(body: PasswordChange, request: Request, response: Response):
    with db() as con:
        row = con.execute("SELECT pw_hash FROM user").fetchone()
        if not auth.verify_password(row["pw_hash"], body.old):
            raise HTTPException(403, "Das bisherige Passwort stimmt nicht.")
        con.execute("UPDATE user SET pw_hash = ?", (auth.hash_password(body.new),))
    auth.end_all_sessions()
    auth.start_session(request, response)
    return {"ok": True}


# ---------------------------------------------------------------- settings

@app.get("/api/settings", dependencies=[Depends(auth.require_user)])
def get_settings():
    with db() as con:
        row = con.execute("SELECT value FROM setting WHERE key = 'ui'").fetchone()
    return json.loads(row["value"]) if row else {}


@app.put("/api/settings", dependencies=[Depends(auth.require_user)])
async def put_settings(request: Request):
    raw = await request.body()
    if len(raw) > 512_000:
        raise HTTPException(413, "Einstellungen sind zu groß.")
    try:
        value = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(400, "Kein gültiges JSON.") from exc
    if not isinstance(value, dict):
        raise HTTPException(400, "Erwartet wird ein Objekt.")
    with db() as con:
        con.execute(
            "INSERT INTO setting(key, value) VALUES('ui', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(value),),
        )
    return {"ok": True}


# ---------------------------------------------------------------- books

def book_dir(book_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{12}", book_id):
        raise HTTPException(404, "Buch nicht gefunden.")
    return DATA_DIR / "books" / book_id


def book_row(con, book_id: str):
    row = con.execute("SELECT * FROM book WHERE id = ?", (book_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Buch nicht gefunden.")
    return row


BOOK_LIST = """
SELECT b.id, b.title, b.author, b.format, b.words, b.created,
       p.fraction, p.updated AS read_at
FROM book b LEFT JOIN progress p ON p.book_id = b.id
ORDER BY COALESCE(p.updated, b.created) DESC
"""


@app.get("/api/books", dependencies=[Depends(auth.require_user)])
def list_books():
    with db() as con:
        return [dict(row) for row in con.execute(BOOK_LIST)]


@app.post("/api/books", dependencies=[Depends(auth.require_user)])
def upload_book(file: UploadFile):
    limit = MAX_UPLOAD_MB * 1024 * 1024
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"Die Datei ist größer als {MAX_UPLOAD_MB} MB.")
    if not data:
        raise HTTPException(400, "Die Datei ist leer.")
    filename = Path(file.filename or "datei").name
    try:
        fmt, doc = extract(filename, data)
    except ExtractError as exc:
        raise HTTPException(422, str(exc)) from exc

    book_id = uuid.uuid4().hex[:12]
    folder = book_dir(book_id)
    folder.mkdir(parents=True)
    (folder / f"original.{fmt}").write_bytes(data)
    title, author, words = doc.pop("title"), doc.pop("author"), doc.pop("words")
    (folder / "doc.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with db() as con:
        con.execute(
            "INSERT INTO book(id, title, author, format, filename, words, created) VALUES(?,?,?,?,?,?,?)",
            (book_id, title or filename, author, fmt, filename, words, time.time()),
        )
    return {"id": book_id, "title": title, "format": fmt, "words": words}


class BookPatch(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    author: str = Field(default="", max_length=300)


@app.get("/api/books/{book_id}", dependencies=[Depends(auth.require_user)])
def get_book(book_id: str):
    with db() as con:
        return dict(book_row(con, book_id))


@app.patch("/api/books/{book_id}", dependencies=[Depends(auth.require_user)])
def patch_book(book_id: str, body: BookPatch):
    with db() as con:
        book_row(con, book_id)
        con.execute("UPDATE book SET title = ?, author = ? WHERE id = ?", (body.title.strip(), body.author.strip(), book_id))
    return {"ok": True}


@app.delete("/api/books/{book_id}", dependencies=[Depends(auth.require_user)])
def delete_book(book_id: str):
    folder = book_dir(book_id)
    with db() as con:
        book_row(con, book_id)
        con.execute("DELETE FROM book WHERE id = ?", (book_id,))
        con.execute("DELETE FROM reading WHERE book_id = ?", (book_id,))
    shutil.rmtree(folder, ignore_errors=True)
    return {"ok": True}


@app.get("/api/books/{book_id}/doc", dependencies=[Depends(auth.require_user)])
def get_doc(book_id: str):
    path = book_dir(book_id) / "doc.json"
    if not path.exists():
        raise HTTPException(404, "Buch nicht gefunden.")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "private, max-age=31536000"})


MEDIA = {
    "pdf": "application/pdf",
    "epub": "application/epub+zip",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain; charset=utf-8",
    "md": "text/plain; charset=utf-8",
    "html": "text/plain; charset=utf-8",  # never rendered as a page from this origin
}


@app.get("/api/books/{book_id}/file", dependencies=[Depends(auth.require_user)])
def get_file(book_id: str):
    with db() as con:
        row = book_row(con, book_id)
    path = book_dir(book_id) / f"original.{row['format']}"
    if not path.exists():
        raise HTTPException(404, "Originaldatei fehlt.")
    return FileResponse(
        path,
        media_type=MEDIA[row["format"]],
        headers={"Cache-Control": "private, max-age=31536000", "Content-Security-Policy": "sandbox"},
    )


class Progress(BaseModel):
    para: int = Field(ge=0)
    offset: int = Field(ge=0)
    fraction: float = Field(ge=0, le=1)
    wpm: int | None = Field(default=None, ge=50, le=2000)
    updated: float


@app.get("/api/books/{book_id}/progress", dependencies=[Depends(auth.require_user)])
def get_progress(book_id: str):
    with db() as con:
        book_row(con, book_id)
        row = con.execute("SELECT para, offset, fraction, wpm, updated FROM progress WHERE book_id = ?", (book_id,)).fetchone()
    return dict(row) if row else None


@app.put("/api/books/{book_id}/progress", dependencies=[Depends(auth.require_user)])
def put_progress(book_id: str, body: Progress):
    """Last writer wins by the client's timestamp, so an offline device can sync later."""
    stamp = min(body.updated, time.time() + 60)
    with db() as con:
        book_row(con, book_id)
        con.execute(
            """INSERT INTO progress(book_id, para, offset, fraction, wpm, updated) VALUES(?,?,?,?,?,?)
               ON CONFLICT(book_id) DO UPDATE SET para = excluded.para, offset = excluded.offset,
                 fraction = excluded.fraction, wpm = excluded.wpm, updated = excluded.updated
               WHERE excluded.updated >= progress.updated""",
            (book_id, body.para, body.offset, body.fraction, body.wpm, stamp),
        )
        row = con.execute("SELECT para, offset, fraction, wpm, updated FROM progress WHERE book_id = ?", (book_id,)).fetchone()
    return dict(row)


class Bookmark(BaseModel):
    para: int = Field(ge=0)
    offset: int = Field(ge=0)
    snippet: str = Field(max_length=300)


@app.get("/api/books/{book_id}/bookmarks", dependencies=[Depends(auth.require_user)])
def list_bookmarks(book_id: str):
    with db() as con:
        rows = con.execute(
            "SELECT id, para, offset, snippet, created FROM bookmark WHERE book_id = ? ORDER BY para, offset", (book_id,)
        )
        return [dict(row) for row in rows]


@app.post("/api/books/{book_id}/bookmarks", dependencies=[Depends(auth.require_user)])
def add_bookmark(book_id: str, body: Bookmark):
    with db() as con:
        book_row(con, book_id)
        cursor = con.execute(
            "INSERT INTO bookmark(book_id, para, offset, snippet, created) VALUES(?,?,?,?,?)",
            (book_id, body.para, body.offset, body.snippet, time.time()),
        )
        return {"id": cursor.lastrowid, **body.model_dump(), "created": time.time()}


@app.delete("/api/bookmarks/{bookmark_id}", dependencies=[Depends(auth.require_user)])
def delete_bookmark(bookmark_id: int):
    with db() as con:
        con.execute("DELETE FROM bookmark WHERE id = ?", (bookmark_id,))
    return {"ok": True}


# ---------------------------------------------------------------- statistics

class Reading(BaseModel):
    book_id: str
    started: float
    active_ms: int = Field(ge=0, le=86_400_000)
    words: int = Field(ge=0, le=5_000_000)


@app.post("/api/readings", dependencies=[Depends(auth.require_user)])
def add_reading(body: Reading):
    if body.words == 0 or body.active_ms < 1000:
        return {"ok": True}
    with db() as con:
        con.execute(
            "INSERT INTO reading(book_id, started, active_ms, words) VALUES(?,?,?,?)",
            (body.book_id, body.started, body.active_ms, body.words),
        )
    return {"ok": True}


@app.get("/api/stats", dependencies=[Depends(auth.require_user)])
def stats(tz_offset_min: int = 0):
    shift = -tz_offset_min * 60  # JavaScript's getTimezoneOffset is minutes behind UTC
    with db() as con:
        total = con.execute("SELECT COALESCE(SUM(active_ms),0) ms, COALESCE(SUM(words),0) words, COUNT(*) n FROM reading").fetchone()
        days = con.execute(
            """SELECT date(started + ?, 'unixepoch') day, SUM(active_ms) ms, SUM(words) words
               FROM reading WHERE started > ? GROUP BY day ORDER BY day""",
            (shift, time.time() - 30 * 86400),
        ).fetchall()
        books = con.execute(
            """SELECT b.id, b.title, SUM(r.active_ms) ms, SUM(r.words) words
               FROM reading r JOIN book b ON b.id = r.book_id GROUP BY b.id ORDER BY ms DESC LIMIT 20"""
        ).fetchall()
    return {"total": dict(total), "days": [dict(d) for d in days], "books": [dict(b) for b in books]}


# ---------------------------------------------------------------- plugins

PLUGIN_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.js$")
SCOPES = ("builtin", "local")


@app.get("/api/plugins", dependencies=[Depends(auth.require_user)])
def list_plugins():
    found = []
    for scope in SCOPES:
        folder = PLUGIN_DIR / scope
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.js")):
            if PLUGIN_NAME.match(path.name):
                found.append({
                    "id": f"{scope}/{path.stem}",
                    "url": f"/api/plugins/{scope}/{path.name}",
                    "version": str(path.stat().st_mtime_ns),
                })
    return found


@app.get("/api/plugins/{scope}/{name}", dependencies=[Depends(auth.require_user)])
def get_plugin(scope: str, name: str):
    if scope not in SCOPES or not PLUGIN_NAME.match(name):
        raise HTTPException(404, "Script nicht gefunden.")
    path = PLUGIN_DIR / scope / name
    if not path.is_file():
        raise HTTPException(404, "Script nicht gefunden.")
    return FileResponse(path, media_type="text/javascript", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- frontend

@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Unbekannter Endpunkt.")
    root = DIST_DIR.resolve()
    target = (root / path).resolve()
    if path and target.is_file() and root in target.parents:
        headers = {}
        if path.startswith("engine/"):
            headers = {"Content-Security-Policy": ENGINE_CSP, "Cache-Control": "no-cache"}
        elif path.startswith("assets/"):
            headers = {"Cache-Control": "public, max-age=31536000, immutable"}
        elif path == "sw.js":
            headers = {"Cache-Control": "no-cache"}
        return FileResponse(target, headers=headers)
    index = root / "index.html"
    if not index.is_file():
        raise HTTPException(503, "Das Frontend ist nicht gebaut. Im Ordner frontend: npm install && npm run build")
    return FileResponse(index, headers={"Content-Security-Policy": PAGE_CSP, "Cache-Control": "no-cache"})

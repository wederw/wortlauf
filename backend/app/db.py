import sqlite3
from contextlib import contextmanager

from .config import DATA_DIR

SCHEMA = """
CREATE TABLE IF NOT EXISTS user(
  id INTEGER PRIMARY KEY CHECK(id = 1),
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session(
  token_hash TEXT PRIMARY KEY,
  expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS book(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL,
  filename TEXT NOT NULL,
  words INTEGER NOT NULL,
  created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS progress(
  book_id TEXT PRIMARY KEY REFERENCES book(id) ON DELETE CASCADE,
  para INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  fraction REAL NOT NULL,
  wpm INTEGER,
  updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS bookmark(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES book(id) ON DELETE CASCADE,
  para INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  snippet TEXT NOT NULL,
  created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS reading(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  started REAL NOT NULL,
  active_ms INTEGER NOT NULL,
  words INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS setting(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DATA_DIR / "wortlauf.sqlite3", timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    return con


def init() -> None:
    con = _connect()
    try:
        con.executescript(SCHEMA)
        con.commit()
    finally:
        con.close()


@contextmanager
def db():
    con = _connect()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

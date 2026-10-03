"""Turn an uploaded file into a neutral document: paragraphs plus a chapter list.

Output shape (stored as doc.json, consumed by the frontend):
    {"chapters": [{"title": str, "start": int}], "paras": [{"t": str, "h"?: int, "pg"?: int}]}

`start` is the index of the chapter's first paragraph, `h` a heading level, `pg` a 1-based page.
Only permissively licensed parsers are used (pypdf plus the standard library).
"""

import io
import posixpath
import re
import statistics
import zipfile
from html.parser import HTMLParser
from urllib.parse import unquote, urldefrag
from xml.etree import ElementTree as ET


class ExtractError(Exception):
    pass


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("­", "")).strip()


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc)
        except UnicodeError:
            continue
    return data.decode("cp1252", errors="replace")


# ---------------------------------------------------------------- HTML blocks

_BLOCK = {
    "p", "div", "li", "blockquote", "section", "article", "pre", "dd", "dt", "tr",
    "figcaption", "table", "ul", "ol", "header", "footer", "aside", "main", "hr", "body",
}
_SKIP = {"script", "style", "head", "svg", "math", "template", "noscript"}
_HEADING = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}


class _Blocks(HTMLParser):
    """Collects block-level text as paragraphs, remembering element ids for TOC anchors."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[dict] = []
        self.title = ""
        self._buf: list[str] = []
        self._skip = 0
        self._h = 0
        self._ids: list[str] = []
        self._in_title = False

    def _flush(self):
        text = _clean("".join(self._buf))
        self._buf = []
        if text:
            para = {"t": text, "ids": self._ids}
            if self._h:
                para["h"] = self._h
            self.out.append(para)
            self._ids = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag in _SKIP:
            self._skip += 1
            return
        if self._skip:
            return
        if tag in _HEADING:
            self._flush()
            self._h = _HEADING[tag]
        elif tag in _BLOCK:
            self._flush()
        elif tag == "br":
            self._buf.append(" ")
        # ids are recorded after the flush so they attach to the text that follows them
        for key, value in attrs:
            if key == "id" and value:
                self._ids.append(value)

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in _SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag in _HEADING:
            self._flush()
            self._h = 0
        elif tag in _BLOCK or tag in ("td", "th"):
            if tag in ("td", "th"):
                self._buf.append(" ")
            else:
                self._flush()

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if not self._skip:
            self._buf.append(data)

    def close(self):
        super().close()
        self._flush()


def _html_blocks(markup: str) -> _Blocks:
    parser = _Blocks()
    parser.feed(markup)
    parser.close()
    return parser


class _Anchors(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            title = _clean("".join(self._text))
            if title:
                self.links.append((self._href, title))
            self._href = None


# ---------------------------------------------------------------- finishing

def _finish(title: str, author: str, paras: list[dict], chapters: list[dict]) -> dict:
    if not paras:
        raise ExtractError("In der Datei wurde kein Text gefunden.")
    for para in paras:
        para.pop("ids", None)

    if not chapters:
        chapters = [{"title": p["t"][:120], "start": i} for i, p in enumerate(paras) if p.get("h") in (1, 2)]

    chapters = sorted(
        (c for c in chapters if 0 <= c["start"] < len(paras)), key=lambda c: c["start"]
    )
    unique: list[dict] = []
    for chapter in chapters:
        if unique and unique[-1]["start"] == chapter["start"]:
            continue
        unique.append({"title": _clean(chapter["title"])[:120] or "Ohne Titel", "start": chapter["start"]})
    if not unique:
        unique = [{"title": title or "Text", "start": 0}]
    elif unique[0]["start"] > 0:
        unique.insert(0, {"title": "Anfang", "start": 0})

    words = sum(len(p["t"].split()) for p in paras)
    return {
        "title": _clean(title)[:300],
        "author": _clean(author)[:300],
        "words": words,
        "chapters": unique,
        "paras": paras,
    }


# ---------------------------------------------------------------- EPUB

def _zip_text(archive: zipfile.ZipFile, path: str) -> str:
    try:
        return _decode(archive.read(path))
    except KeyError:
        return ""


def _epub_toc(archive, manifest, base) -> list[tuple[str, str, str]]:
    """Returns (file path, fragment, title) in reading order."""
    entries: list[tuple[str, str, str]] = []

    def resolve(doc_path: str, href: str) -> tuple[str, str]:
        target, fragment = urldefrag(href)
        path = posixpath.normpath(posixpath.join(posixpath.dirname(doc_path), unquote(target)))
        return path, unquote(fragment)

    nav = next((i for i in manifest.values() if "nav" in (i.get("properties") or "").split()), None)
    if nav is not None:
        nav_path = posixpath.normpath(posixpath.join(base, unquote(nav.get("href"))))
        anchors = _Anchors()
        anchors.feed(_zip_text(archive, nav_path))
        for href, title in anchors.links:
            if href and not re.match(r"^[a-z]+:", href):
                entries.append((*resolve(nav_path, href), title))
    if entries:
        return entries

    ncx = next((i for i in manifest.values() if i.get("media-type") == "application/x-dtbncx+xml"), None)
    if ncx is not None:
        ncx_path = posixpath.normpath(posixpath.join(base, unquote(ncx.get("href"))))
        try:
            root = ET.fromstring(archive.read(ncx_path))
        except (KeyError, ET.ParseError):
            return entries
        for point in root.findall(".//{*}navPoint"):
            label = point.find("{*}navLabel/{*}text")
            content = point.find("{*}content")
            if label is not None and content is not None and content.get("src"):
                entries.append((*resolve(ncx_path, content.get("src")), label.text or ""))
    return entries


def extract_epub(data: bytes, fallback_title: str) -> dict:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        opf_path = container.find(".//{*}rootfile").get("full-path")
        opf = ET.fromstring(archive.read(opf_path))
    except (zipfile.BadZipFile, KeyError, ET.ParseError, AttributeError) as exc:
        raise ExtractError("Die ePub-Datei ist beschädigt oder kein gültiges ePub.") from exc

    base = posixpath.dirname(opf_path)
    title = opf.findtext(".//{*}metadata/{*}title") or fallback_title
    author = opf.findtext(".//{*}metadata/{*}creator") or ""
    manifest = {item.get("id"): item for item in opf.findall(".//{*}manifest/{*}item")}
    spine = [
        manifest[ref.get("idref")]
        for ref in opf.findall(".//{*}spine/{*}itemref")
        if ref.get("idref") in manifest and ref.get("linear") != "no"
    ]

    toc_by_file: dict[str, list[tuple[str, str]]] = {}
    for path, fragment, entry_title in _epub_toc(archive, manifest, base):
        toc_by_file.setdefault(path, []).append((fragment, entry_title))

    paras: list[dict] = []
    chapters: list[dict] = []
    for item in spine:
        path = posixpath.normpath(posixpath.join(base, unquote(item.get("href") or "")))
        blocks = _html_blocks(_zip_text(archive, path)).out
        if not blocks:
            continue
        start = len(paras)
        paras.extend(blocks)
        if toc_by_file:
            for fragment, entry_title in toc_by_file.get(path, []):
                index = start
                if fragment:
                    index = next(
                        (start + n for n, block in enumerate(blocks) if fragment in block["ids"]), start
                    )
                chapters.append({"title": entry_title, "start": index})
        else:
            heading = next((b["t"] for b in blocks if b.get("h")), None)
            chapters.append({"title": heading or f"Abschnitt {len(chapters) + 1}", "start": start})

    if not paras and "META-INF/encryption.xml" in archive.namelist():
        raise ExtractError("Das ePub ist kopiergeschützt (DRM) und lässt sich nicht lesen.")
    return _finish(title, author, paras, chapters)


# ---------------------------------------------------------------- PDF

_PAGE_NUMBER = re.compile(r"^\W*(seite|page)?\W*\d{1,4}\W*$", re.IGNORECASE)
_SENTENCE_END = re.compile(r"[.!?:…][\"'»«”“’)\]]*$")


def _strip_running_lines(pages: list[list[str]]) -> None:
    """Drops headers and footers that repeat on most pages, and bare page numbers."""

    def key(line: str) -> str:
        return re.sub(r"\d+", "#", line.strip().lower())

    for position in (0, -1):
        if len(pages) >= 4:
            counts: dict[str, int] = {}
            for lines in pages:
                if lines:
                    counts[key(lines[position])] = counts.get(key(lines[position]), 0) + 1
            repeated = {k for k, n in counts.items() if n > len(pages) * 0.5 and k}
        else:
            repeated = set()
        for lines in pages:
            if lines and (key(lines[position]) in repeated or _PAGE_NUMBER.match(lines[position])):
                lines.pop(position)


_COLUMN_GAP = re.compile(r"\S {4,}\S")


def _pdf_page_lines(page) -> list[str]:
    """Text lines of one page; an empty string marks a vertical gap.

    Layout mode keeps the gaps between paragraphs, which plain mode loses. It also keeps
    columns side by side on one line, so pages that look multi-column fall back to plain mode.
    """
    try:
        lines = [line.strip() for line in (page.extract_text(extraction_mode="layout") or "").splitlines()]
    except Exception:
        lines = []
    filled = [line for line in lines if line]
    columns = sum(1 for line in filled if _COLUMN_GAP.search(line))
    if not filled or columns > len(filled) * 0.3:
        try:
            return [line.strip() for line in (page.extract_text() or "").splitlines()]
        except Exception:  # a single broken page should not sink the whole book
            return []
    # Generously spaced text puts a gap after every line; then only larger gaps count.
    single_gaps = sum(
        1 for i in range(1, len(lines) - 1) if not lines[i] and lines[i - 1] and lines[i + 1]
    )
    if single_gaps > len(filled) * 0.6:
        lines = [
            line for i, line in enumerate(lines)
            if line or not (0 < i < len(lines) - 1 and lines[i - 1] and lines[i + 1])
        ]
    return lines


def extract_pdf(data: bytes, fallback_title: str) -> dict:
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ExtractError("Das PDF ist passwortgeschützt.")
        pages = [_pdf_page_lines(page) for page in reader.pages]
    except PyPdfError as exc:
        raise ExtractError("Das PDF ließ sich nicht lesen.") from exc

    for lines in pages:
        while lines and not lines[0]:
            lines.pop(0)
        while lines and not lines[-1]:
            lines.pop()
    _strip_running_lines(pages)

    lengths = [len(line) for lines in pages for line in lines if line]
    if not lengths:
        raise ExtractError(
            "Das PDF enthält keinen Text, vermutlich ein Scan. Vorher mit OCR behandeln, zum Beispiel mit ocrmypdf."
        )
    median = statistics.median(lengths)

    paras: list[dict] = []
    current = ""
    current_page = 1
    open_across_page = False

    def close():
        nonlocal current
        text = _clean(current)
        if text:
            paras.append({"t": text, "pg": current_page})
        current = ""

    for number, lines in enumerate(pages, start=1):
        for index, line in enumerate(lines):
            if not line:
                close()
                continue
            starts_page = index == 0
            if starts_page and current and not (open_across_page and line[:1].islower()):
                close()
            if not current:
                current_page = number
                current = line
            elif current.endswith(("-", "‐")) and line[:1].islower():
                current = current[:-1] + line
            else:
                current += " " + line
            if _SENTENCE_END.search(line) and len(line) < median * 0.8:
                close()
        open_across_page = bool(current) and not _SENTENCE_END.search(current)
    close()

    chapters: list[dict] = []

    def walk(items):
        for item in items:
            if isinstance(item, list):
                walk(item)
                continue
            try:
                page_number = reader.get_destination_page_number(item) + 1
            except Exception:
                continue
            start = next((i for i, p in enumerate(paras) if p["pg"] >= page_number), None)
            if start is not None and item.title:
                title = _clean(str(item.title))
                # prefer the paragraph that repeats the outline title: it is the heading itself
                for i in range(start, len(paras)):
                    if paras[i]["pg"] != paras[start]["pg"]:
                        break
                    if paras[i]["t"].lower() == title.lower():
                        start = i
                        paras[i]["h"] = 1
                        break
                chapters.append({"title": title, "start": start})

    try:
        walk(reader.outline)
    except Exception:
        chapters = []

    if not chapters:
        step = 10
        for first in range(1, len(pages) + 1, step):
            start = next((i for i, p in enumerate(paras) if p["pg"] >= first), None)
            if start is not None:
                last = min(first + step - 1, len(pages))
                chapters.append({"title": f"Seite {first}–{last}", "start": start})

    meta = reader.metadata or {}
    title = (getattr(meta, "title", None) or "").strip() or fallback_title
    author = (getattr(meta, "author", None) or "").strip()
    return _finish(title, author, paras, chapters)


# ---------------------------------------------------------------- DOCX

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def extract_docx(data: bytes, fallback_title: str) -> dict:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        body = ET.fromstring(archive.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ExtractError("Die Word-Datei ließ sich nicht lesen.") from exc

    paras: list[dict] = []
    for node in body.iter(f"{_W}p"):
        parts = []
        for child in node.iter():
            if child.tag == f"{_W}t":
                parts.append(child.text or "")
            elif child.tag in (f"{_W}tab", f"{_W}br"):
                parts.append(" ")
        text = _clean("".join(parts))
        if not text:
            continue
        para = {"t": text}
        style = node.find(f"{_W}pPr/{_W}pStyle")
        if style is not None:
            name = style.get(f"{_W}val") or ""
            match = re.search(r"(?:heading|berschrift)\s*(\d)", name, re.IGNORECASE)
            if match:
                para["h"] = int(match.group(1))
            elif name.lower() in ("title", "titel"):
                para["h"] = 1
        paras.append(para)

    title, author = fallback_title, ""
    try:
        core = ET.fromstring(archive.read("docProps/core.xml"))
        title = core.findtext("{*}title") or fallback_title
        author = core.findtext("{*}creator") or ""
    except (KeyError, ET.ParseError):
        pass
    return _finish(title, author, paras, [])


# ---------------------------------------------------------------- text formats

_MD_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*$")
_PLAIN_HEADING = re.compile(
    r"^(kapitel|chapter|teil|part|buch|book|abschnitt|prolog|epilog|prologue|epilogue)\b.{0,60}$",
    re.IGNORECASE,
)


def _strip_markdown(text: str) -> str:
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"(\*\*|__|\*|_|`|~~)(?=\S)(.+?)(?<=\S)\1", r"\2", text)
    return re.sub(r"^\s*(?:[-*+]|\d+\.)\s+", "", text)


def extract_text(data: bytes, fallback_title: str, markdown: bool) -> dict:
    text = _decode(data).replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", text)
    if len(blocks) < 3 and text.count("\n") > 20:
        blocks = text.split("\n")  # no blank lines at all: every line is a paragraph

    paras: list[dict] = []
    fenced = False
    for block in blocks:
        lines = [line for line in block.split("\n") if line.strip()]
        pending: list[str] = []

        def close():
            if pending:
                joined = _clean(" ".join(pending))
                if joined:
                    paras.append({"t": _strip_markdown(joined) if markdown else joined})
                pending.clear()

        for line in lines:
            if markdown and line.strip().startswith("```"):
                fenced = not fenced
                close()
                continue
            heading = _MD_HEADING.match(line.strip()) if markdown and not fenced else None
            if heading:
                close()
                paras.append({"t": _strip_markdown(heading.group(2)), "h": len(heading.group(1))})
            elif not markdown and len(lines) == 1 and _PLAIN_HEADING.match(line.strip()):
                paras.append({"t": _clean(line), "h": 2})
            elif markdown and re.match(r"^\s*([-*_])\s*(\1\s*){2,}$", line):
                close()
            elif markdown and not fenced and re.match(r"^\s*(?:[-*+]|\d+\.)\s+", line):
                close()
                pending.append(line)
            else:
                pending.append(line)
        close()
    return _finish(fallback_title, "", paras, [])


def extract_html(data: bytes, fallback_title: str) -> dict:
    parsed = _html_blocks(_decode(data))
    return _finish(_clean(parsed.title) or fallback_title, "", parsed.out, [])


# ---------------------------------------------------------------- dispatch

FORMATS = ("pdf", "epub", "docx", "txt", "md", "html")


def detect_format(filename: str, data: bytes) -> str:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:2] == b"PK":
        try:
            names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
        except zipfile.BadZipFile as exc:
            raise ExtractError("Die Datei ist beschädigt.") from exc
        if "META-INF/container.xml" in names:
            return "epub"
        if "word/document.xml" in names:
            return "docx"
        raise ExtractError("Dieses Archivformat wird nicht unterstützt.")
    if extension in ("md", "markdown"):
        return "md"
    if extension in ("html", "htm", "xhtml"):
        return "html"
    if extension in ("txt", "text", ""):
        return "txt"
    raise ExtractError(
        f"Das Format .{extension} wird nicht unterstützt. Möglich sind PDF, ePub, DOCX, TXT, Markdown und HTML."
    )


def extract(filename: str, data: bytes) -> tuple[str, dict]:
    fmt = detect_format(filename, data)
    fallback = filename.rsplit(".", 1)[0] if "." in filename else filename
    fallback = fallback or "Ohne Titel"
    if fmt == "pdf":
        return fmt, extract_pdf(data, fallback)
    if fmt == "epub":
        return fmt, extract_epub(data, fallback)
    if fmt == "docx":
        return fmt, extract_docx(data, fallback)
    if fmt == "html":
        return fmt, extract_html(data, fallback)
    return fmt, extract_text(data, fallback, markdown=fmt == "md")

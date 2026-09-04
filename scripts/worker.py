#!/usr/bin/env python3
"""Gateway Tasks worker: generate book inventory (prep + article status).

Uses the Python pipeline from idiomas-puentes-docs (prep_portions +
check_article_status). Bind only to loopback.

    npm run worker
    # or: python scripts/worker.py

POST /jobs body:
  {"book": "NEH", "lang": "es-419", "contentOrg": "es-419_gl"}
  {"book": "TIT", "fixture": true}
  {"book": "NEH", "fixture": true}  # local snapshot

Env:
  GATEWAY_TASKS_DOCS_SCRIPTS  path to idiomas-puentes-docs/scripts
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import traceback
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent


def _resolve_docs_scripts() -> Path:
    env = os.environ.get("GATEWAY_TASKS_DOCS_SCRIPTS", "").strip()
    candidates = []
    if env:
        candidates.append(Path(env))
    candidates.extend(
        [
            REPO_ROOT.parent / "idiomas-puentes-docs" / "scripts",
            Path.home() / "idiomas-puentes-docs" / "scripts",
            Path("C:/Users/LENOVO/idiomas-puentes-docs/scripts"),
        ]
    )
    for path in candidates:
        if (path / "prep_portions.py").exists() and (path / "check_article_status.py").exists():
            return path.resolve()
    raise SystemExit(
        "No se encontró idiomas-puentes-docs/scripts. "
        "Define GATEWAY_TASKS_DOCS_SCRIPTS o clona el repo al lado de gateway-tasks."
    )


DOCS_SCRIPTS = _resolve_docs_scripts()
if str(DOCS_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(DOCS_SCRIPTS))

from fcr_prep.discover import USFM_BOOK_NUM, book_usfm_name  # noqa: E402
from fcr_status.emit import portions_from_prep, unassigned_from_prep  # noqa: E402
from fcr_status.http import HttpError, get_bytes  # noqa: E402

HOST = "127.0.0.1"
PORT = 8765
CACHE_DIR = REPO_ROOT / "out" / ".dcs-cache"
FETCH_ROOT = REPO_ROOT / "out" / "fetch"
JOBS_ROOT = REPO_ROOT / "out" / "jobs"
FIXTURE_DIR = DOCS_SCRIPTS / "fixtures" / "prep_portions"
PREP_CLI = DOCS_SCRIPTS / "prep_portions.py"
STATUS_CLI = DOCS_SCRIPTS / "check_article_status.py"
SNAPSHOT_NEH = REPO_ROOT / "public" / "data" / "neh-status.json"
DOCS_NEH_SOURCE = DOCS_SCRIPTS.parent / "out" / "neh-prep" / "source"

DOOR43_RAW = "https://git.door43.org/unfoldingWord/{repo}/raw/branch/{branch}/{path}"
COMPANION_REPOS = {
    "ult": "en_ult",
    "ust": "en_ust",
    "tn": "en_tn",
    "tq": "en_tq",
    "twl": "en_twl",
}

JOBS: dict[str, dict[str, Any]] = {}
JOB_LOCK = threading.Lock()
RUN_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _public_job(job: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "id": job["id"],
        "book": job["book"],
        "lang": job.get("lang") or "",
        "contentOrg": job.get("contentOrg") or "",
        "fixture": bool(job.get("fixture")),
        "status": job["status"],
        "step": job.get("step") or "",
        "message": job.get("message") or "",
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }
    if job["status"] == "done":
        payload["result"] = job.get("result")
    return payload


def _update_job(job_id: str, **fields: Any) -> None:
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = _now()


def _active_job_id() -> str | None:
    with JOB_LOCK:
        for job in JOBS.values():
            if job["status"] in {"queued", "running"}:
                return str(job["id"])
    return None


def _cors_origin(handler: BaseHTTPRequestHandler) -> str | None:
    origin = handler.headers.get("Origin") or ""
    if not origin:
        return None
    parsed = urlparse(origin)
    host = (parsed.hostname or "").lower()
    if host in {"localhost", "127.0.0.1", "[::1]", "::1"}:
        return origin
    return None


def _send_cors(handler: BaseHTTPRequestHandler) -> None:
    origin = _cors_origin(handler)
    if origin:
        handler.send_header("Access-Control-Allow-Origin", origin)
        handler.send_header("Vary", "Origin")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")


def _send_json(handler: BaseHTTPRequestHandler, code: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    _send_cors(handler)
    handler.end_headers()
    handler.wfile.write(body)


def _read_json_body(handler: BaseHTTPRequestHandler) -> Any:
    length = int(handler.headers.get("Content-Length") or 0)
    raw = handler.rfile.read(length) if length else b"{}"
    if not raw.strip():
        return {}
    return json.loads(raw.decode("utf-8"))


def _normalize_book(value: str) -> str:
    return (value or "").strip().upper()


def _default_repos(lang: str, content_org: str) -> tuple[str, str, str]:
    base = (lang or "es-419").strip().lower().replace("_gl", "")
    org = (content_org or f"{base}_gl").strip()
    return org, f"{base}_ta", f"{base}_tw"


def _book_paths(book: str) -> dict[str, str]:
    usfm = book_usfm_name(book)
    return {
        "ult": usfm,
        "ust": usfm.replace(".usfm", ".ust.usfm") if usfm.endswith(".usfm") else f"{book}.ust.usfm",
        "tn": f"tn_{book}.tsv",
        "tq": f"tq_{book}.tsv",
        "twl": f"twl_{book}.tsv",
    }


def _copy_or_write(dest: Path, data: bytes) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def _try_download(url: str) -> bytes | None:
    try:
        response = get_bytes(url, CACHE_DIR, timeout=90)
    except (HttpError, OSError, TimeoutError):
        return None
    if response.status != 200 or not response.body:
        return None
    return response.body


def _download_companion(kind: str, book: str, dest: Path) -> Path | None:
    names = _book_paths(book)
    filename = names[kind]
    repo = COMPANION_REPOS[kind]
    book_l = book.lower()
    num = USFM_BOOK_NUM.get(book)
    candidates: list[str] = [filename]
    if kind in {"ult", "ust"} and num:
        candidates.append(f"{num}-{book}.usfm")
    if kind == "ust" and num:
        candidates.append(f"{num}-{book}.ust.usfm")
    candidates.extend([f"{book}/{filename}", f"{book_l}/{filename}"])
    ot = set(list(USFM_BOOK_NUM.keys())[:39])
    testament = "ot" if book in ot else "nt"
    candidates.append(f"{testament}/{book_l}/{filename}")

    for branch in ("master", "main"):
        for path in candidates:
            url = DOOR43_RAW.format(repo=repo, branch=branch, path=path)
            body = _try_download(url)
            if body:
                return _copy_or_write(dest, body)
    return None


def _resolve_existing(folder: Path, book: str) -> dict[str, Path | None]:
    names = _book_paths(book)
    found: dict[str, Path | None] = {key: None for key in names}
    for path in [folder / names["ult"], folder / f"{book}.usfm"]:
        if path.exists():
            found["ult"] = path
            break
    for path in [folder / names["ust"], folder / f"{book}.ust.usfm"]:
        if path.exists():
            found["ust"] = path
            break
    for key in ("tn", "tq", "twl"):
        path = folder / names[key]
        if path.exists():
            found[key] = path
    return found


def _local_source_dir(book: str) -> Path | None:
    if book == "NEH" and (DOCS_NEH_SOURCE / "16-NEH.usfm").exists():
        return DOCS_NEH_SOURCE
    existing = FETCH_ROOT / book
    if (existing / book_usfm_name(book)).exists() or (existing / f"{book}.usfm").exists():
        return existing
    return None


def _fixture_paths() -> dict[str, Path | None]:
    return {
        "ult": FIXTURE_DIR / "57-TIT-sample.usfm",
        "ust": None,
        "tn": FIXTURE_DIR / "tn_TIT.tsv",
        "tq": FIXTURE_DIR / "tq_TIT.tsv",
        "twl": FIXTURE_DIR / "twl_TIT.tsv",
    }


def fetch_package(book: str, job_id: str) -> dict[str, Path | None]:
    local = _local_source_dir(book)
    if local is not None:
        found = _resolve_existing(local, book)
        if found.get("ult") is not None:
            return found

    dest_dir = FETCH_ROOT / book
    dest_dir.mkdir(parents=True, exist_ok=True)
    names = _book_paths(book)
    found = _resolve_existing(dest_dir, book)
    if found.get("ult") is None:
        _update_job(job_id, step="fetch", message="Descargando ULT y compañeros…")
        ult = _download_companion("ult", book, dest_dir / names["ult"])
        if ult is None:
            raise RuntimeError(
                f"No se pudo descargar el ULT de {book}. Usa Cargar JSON o la instantánea NEH."
            )
        found["ult"] = ult
    for kind in ("tn", "tq", "twl", "ust"):
        if found.get(kind) is not None:
            continue
        found[kind] = _download_companion(kind, book, dest_dir / names[kind])
    return found


def _run_cli(args: list[str], label: str) -> str:
    command = [sys.executable, *args]
    completed = subprocess.run(
        command,
        cwd=str(DOCS_SCRIPTS.parent),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if completed.returncode != 0:
        err = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(f"{label} falló ({completed.returncode}): {err[:1200]}")
    text = completed.stdout or ""
    if not text.strip():
        raise RuntimeError(f"{label} no escribió JSON en stdout.")
    return text


def run_prep(book: str, paths: dict[str, Path | None], dest: Path) -> dict[str, Any]:
    args: list[str] = [
        str(PREP_CLI),
        "--book",
        book,
        "--format",
        "json",
        "--out",
        "-",
    ]
    ult = paths.get("ult")
    if ult is None:
        raise RuntimeError("Falta el ULT.")
    args.extend(["--ult", str(ult)])
    for flag, key in (("--tn", "tn"), ("--tq", "tq"), ("--twl", "twl"), ("--ust", "ust")):
        path = paths.get(key)
        if path is not None and path.exists():
            args.extend([flag, str(path)])
    text = _run_cli(args, "prep_portions.py")
    dest.write_text(text, encoding="utf-8")
    return json.loads(text)


def synthesize_status(prep: dict[str, Any], *, source: str, lang: str, content_org: str) -> dict[str, Any]:
    portions = portions_from_prep(prep)
    unassigned, _refs = unassigned_from_prep(prep)
    articles: list[dict[str, Any]] = []
    for row in prep.get("palabras") or []:
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("id") or "").strip()
        path = str(row.get("path") or "").strip()
        if not item_id:
            continue
        articles.append(
            {
                "id": item_id,
                "kind": "Translation Words",
                "path": path,
                "status": "missing",
                "title": item_id,
            }
        )
    for row in prep.get("academia") or []:
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("id") or "").strip()
        path = str(row.get("path") or "").strip()
        if not item_id:
            continue
        articles.append(
            {
                "id": item_id,
                "kind": "Translation Academy",
                "path": path,
                "status": "missing",
                "title": item_id,
            }
        )
    counts = {
        "translated": 0,
        "english": 0,
        "incomplete": 0,
        "missing": len(articles),
        "articles": len(articles),
    }
    org, ta, tw = _default_repos(lang, content_org)
    return {
        "schema": "article-status-1",
        "generated_at": _now(),
        "book": str(prep.get("book") or "").upper(),
        "lang": lang,
        "contentOrg": org,
        "source": source,
        "dcs": {"org": org, "ta_repo": ta, "tw_repo": tw, "branch": "master"},
        "counts": {"total": counts},
        "portions": portions,
        "preguntas_sin_asignar": unassigned,
        "articles": articles,
    }


def run_status(prep_path: Path, lang: str, content_org: str) -> dict[str, Any]:
    org, ta, tw = _default_repos(lang, content_org)
    args = [
        str(STATUS_CLI),
        "--from-prep",
        str(prep_path),
        "--org",
        org,
        "--ta-repo",
        ta,
        "--tw-repo",
        tw,
        "--cache-dir",
        str(CACHE_DIR),
        "--format",
        "json",
        "--out",
        "-",
    ]
    text = _run_cli(args, "check_article_status.py")
    result = json.loads(text)
    result["lang"] = lang
    result["contentOrg"] = org
    return result


def load_snapshot(book: str, lang: str, content_org: str) -> dict[str, Any] | None:
    if book != "NEH" or not SNAPSHOT_NEH.exists():
        return None
    data = json.loads(SNAPSHOT_NEH.read_text(encoding="utf-8"))
    if str(data.get("book") or "").upper() != "NEH":
        return None
    data["source"] = "snapshot"
    data["lang"] = lang
    data["contentOrg"] = content_org or data.get("dcs", {}).get("org") or "es-419_gl"
    return data


def execute_job(job_id: str) -> None:
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        book = str(job["book"])
        lang = str(job.get("lang") or "es-419")
        content_org = str(job.get("contentOrg") or "")
        fixture = bool(job.get("fixture"))
    work = JOBS_ROOT / job_id
    work.mkdir(parents=True, exist_ok=True)
    try:
        _update_job(job_id, status="running", step="fetch", message="Descargando ULT y compañeros…")
        if fixture and book == "NEH":
            snapshot = load_snapshot(book, lang, content_org)
            if snapshot is not None:
                _update_job(
                    job_id,
                    status="done",
                    step="done",
                    message="Listo (instantánea local).",
                    result=snapshot,
                )
                return
        if fixture:
            paths = _fixture_paths()
            book = "TIT"
            _update_job(job_id, book=book, message="Usando la fixture local de Tito…")
        else:
            paths = fetch_package(book, job_id)

        _update_job(job_id, step="prep", message="Preparando porciones…")
        prep_path = work / f"{book}.prep.json"
        prep = run_prep(book, paths, prep_path)

        _update_job(job_id, step="status", message="Revisando artículos en DCS…")
        if fixture:
            result = synthesize_status(prep, source="fixture", lang=lang, content_org=content_org)
        else:
            result = run_status(prep_path, lang, content_org)
        status_path = work / f"{book}.status.json"
        status_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        _update_job(job_id, status="done", step="done", message="Listo.", result=result)
    except Exception as exc:
        _update_job(
            job_id,
            status="error",
            step="error",
            message="Error al generar el inventario.",
            error=str(exc),
        )
        traceback.print_exc()
    finally:
        if RUN_LOCK.locked():
            RUN_LOCK.release()


def enqueue_job(book: str, *, lang: str, content_org: str, fixture: bool) -> dict[str, Any]:
    if book not in USFM_BOOK_NUM:
        raise ValueError(f"Libro no reconocido: {book}")
    job_id = str(uuid.uuid4())
    org, _ta, _tw = _default_repos(lang, content_org)
    job = {
        "id": job_id,
        "book": book,
        "lang": lang,
        "contentOrg": org,
        "fixture": fixture,
        "status": "queued",
        "step": "queued",
        "message": "En cola…",
        "error": None,
        "result": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    with JOB_LOCK:
        for existing in JOBS.values():
            if existing["status"] in {"queued", "running"}:
                raise RuntimeError(existing["id"])
        JOBS[job_id] = job
    RUN_LOCK.acquire()
    thread = threading.Thread(target=execute_job, args=(job_id,), daemon=True)
    thread.start()
    return job


class Handler(BaseHTTPRequestHandler):
    server_version = "GatewayTasksWorker/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        _send_cors(self)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/health":
            _send_json(
                self,
                200,
                {
                    "ok": True,
                    "service": "gateway-tasks-worker",
                    "busy": _active_job_id() is not None,
                    "docs_scripts": str(DOCS_SCRIPTS),
                },
            )
            return
        if path.startswith("/jobs/"):
            job_id = path.split("/", 2)[-1]
            with JOB_LOCK:
                job = JOBS.get(job_id)
            if not job:
                _send_json(self, 404, {"error": "Trabajo no encontrado."})
                return
            _send_json(self, 200, _public_job(job))
            return
        _send_json(self, 404, {"error": "No encontrado."})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path != "/jobs":
            _send_json(self, 404, {"error": "No encontrado."})
            return
        try:
            body = _read_json_body(self)
        except json.JSONDecodeError:
            _send_json(self, 400, {"error": "JSON inválido."})
            return
        if not isinstance(body, dict):
            _send_json(self, 400, {"error": "El cuerpo debe ser un objeto."})
            return
        book = _normalize_book(str(body.get("book") or ""))
        lang = str(body.get("lang") or "es-419").strip() or "es-419"
        content_org = str(body.get("contentOrg") or body.get("content_org") or "").strip()
        fixture = bool(body.get("fixture"))
        if not book:
            _send_json(self, 400, {"error": "Falta el libro (book)."})
            return
        try:
            job = enqueue_job(book, lang=lang, content_org=content_org, fixture=fixture)
        except ValueError as exc:
            _send_json(self, 400, {"error": str(exc)})
            return
        except RuntimeError as exc:
            _send_json(
                self,
                409,
                {"error": "Hay un trabajo en curso.", "id": str(exc), "status": "running"},
            )
            return
        _send_json(self, 200, {"id": job["id"], "status": job["status"]})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Worker local de Gateway Tasks.")
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args(argv)
    for path in (CACHE_DIR, FETCH_ROOT, JOBS_ROOT):
        path.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"Gateway Tasks worker http://{args.host}:{args.port}\n"
        f"  docs scripts: {DOCS_SCRIPTS}",
        file=sys.stderr,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando.", file=sys.stderr)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

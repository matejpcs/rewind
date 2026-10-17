import hashlib
import mimetypes
import os
import secrets
from pathlib import Path
from threading import RLock

from flask import Flask, abort, jsonify, redirect, render_template, request, send_file, session, url_for
from mutagen import File as MutagenFile, MutagenError
from mutagen.id3 import APIC
from werkzeug.utils import secure_filename


app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("COOKIE_SECURE", "0") == "1"

MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", "/music")).resolve()
PASSWORD = os.environ.get("APP_PASSWORD", "")
SUPPORTED = {
    ".mp3", ".flac", ".m4a", ".mp4", ".m4b", ".aac", ".ogg", ".oga", ".opus", ".wav",
    ".aiff", ".aif", ".wma", ".ape", ".alac", ".dsf", ".dff", ".mka", ".mkv", ".mpc",
    ".spx", ".tta", ".wv", ".caf", ".ac3", ".amr", ".3gp", ".webm",
}
_library = []
_scan_lock = RLock()


def _tag(tags, *names, default=""):
    if not tags:
        return default
    aliases = {
        "title": "©nam", "artist": "©ART", "album": "©alb", "albumartist": "aART",
        "genre": "©gen", "date": "©day", "year": "©day", "tracknumber": "trkn",
    }
    for name in names:
        value = tags.get(name)
        if value is None and name in aliases:
            value = tags.get(aliases[name])
        if value:
            while isinstance(value, (list, tuple)) and value:
                value = value[0]
            if isinstance(value, bytes):
                value = value.decode("utf-8", errors="replace")
            return str(value)
    return default


def _duration(audio):
    try:
        return int(audio.info.length)
    except (AttributeError, TypeError, ValueError):
        return 0


def scan_library():
    global _library
    found = []
    if MUSIC_DIR.exists():
        for path in MUSIC_DIR.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in SUPPORTED:
                continue
            try:
                relative = path.relative_to(MUSIC_DIR).as_posix()
                audio = MutagenFile(path, easy=True)
                tags = audio.tags if audio else None
                stat = path.stat()
                track_id = hashlib.sha1(relative.encode("utf-8")).hexdigest()[:16]
                title = _tag(tags, "title", default=path.stem)
                album = _tag(tags, "album", default="Unknown Album")
                artist = _tag(tags, "artist", "albumartist", default="Unknown Artist")
                album_artist = _tag(tags, "albumartist", "artist", default="Unknown Artist")
                year_text = _tag(tags, "date", "year", default="")[:4]
                try:
                    year = int(year_text)
                except ValueError:
                    year = 0
                try:
                    track = int(_tag(tags, "tracknumber", default="0").split("/")[0])
                except ValueError:
                    track = 0
                found.append({
                    "id": track_id,
                    "path": relative,
                    "title": title,
                    "artist": artist,
                    "album_artist": album_artist,
                    "album": album,
                    "genre": _tag(tags, "genre", default="Unknown Genre"),
                    "year": year,
                    "track": track,
                    "duration": _duration(audio) if audio else 0,
                    "format": path.suffix[1:].upper(),
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                })
            except (OSError, ValueError):
                continue
    found.sort(key=lambda item: (item["album_artist"].casefold(), item["album"].casefold(), item["track"], item["title"].casefold()))
    with _scan_lock:
        _library = found
    return found


def _track(track_id):
    with _scan_lock:
        return next((item for item in _library if item["id"] == track_id), None)


@app.before_request
def require_login():
    if PASSWORD and request.endpoint not in {"login", "static", "health"} and not session.get("logged_in"):
        if request.path.startswith("/api/") or request.path.startswith("/stream/") or request.path.startswith("/artwork/"):
            return jsonify({"error": "Login required"}), 401
        return redirect(url_for("login", next=request.path))


@app.route("/login", methods=["GET", "POST"])
def login():
    if not PASSWORD:
        return redirect(url_for("index"))
    error = ""
    if request.method == "POST":
        if secrets.compare_digest(request.form.get("password", ""), PASSWORD):
            session.clear()
            session["logged_in"] = True
            next_path = request.args.get("next", "")
            if not next_path.startswith("/") or next_path.startswith("//"):
                next_path = url_for("index")
            return redirect(next_path)
        error = "That password didn’t match. Try again."
    return render_template("login.html", error=error)


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/")
def index():
    return render_template("index.html", protected=bool(PASSWORD))


@app.get("/api/library")
def library():
    if not _library:
        scan_library()
    with _scan_lock:
        tracks = list(_library)
    albums = {}
    artists = set()
    genres = set()
    for track in tracks:
        key = f'{track["album_artist"]}\0{track["album"]}'
        if key not in albums:
            albums[key] = {"id": track["id"], "album": track["album"], "artist": track["album_artist"], "year": track["year"], "count": 0, "tracks": []}
        albums[key]["count"] += 1
        albums[key]["tracks"].append(track["id"])
        artists.add(track["artist"])
        genres.add(track["genre"])
    return jsonify({"tracks": tracks, "albums": list(albums.values()), "artists": sorted(artists), "genres": sorted(genres), "count": len(tracks)})


@app.post("/api/scan")
def rescan():
    tracks = scan_library()
    return jsonify({"count": len(tracks)})


@app.post("/api/upload")
def upload():
    files = request.files.getlist("files")
    if not files or all(not f.filename for f in files):
        return jsonify({"error": "Choose one or more music files first."}), 400
    upload_dir = MUSIC_DIR / "Uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved = 0
    rejected = []
    for uploaded in files:
        if not uploaded.filename:
            continue
        name = secure_filename(Path(uploaded.filename).name)
        if not name or Path(name).suffix.lower() not in SUPPORTED:
            rejected.append(uploaded.filename)
            continue
        destination = upload_dir / name
        if destination.exists():
            stem, suffix = destination.stem, destination.suffix
            number = 2
            while destination.exists():
                destination = upload_dir / f"{stem} ({number}){suffix}"
                number += 1
        uploaded.save(destination)
        saved += 1
    tracks = scan_library()
    return jsonify({"uploaded": saved, "count": len(tracks), "rejected": rejected})


def _write_metadata(path, changes):
    """Update common tags while preserving artwork and all unrelated tags."""
    audio = MutagenFile(path, easy=True)
    if audio is None or not hasattr(audio, "save"):
        raise ValueError("This audio format cannot be edited")
    if audio.tags is None:
        try:
            audio.add_tags()
        except Exception as exc:
            raise ValueError("This audio format does not support writable tags") from exc

    values = {
        "title": str(changes.get("title", "")).strip(),
        "artist": str(changes.get("artist", "")).strip(),
        "album": str(changes.get("album", "")).strip(),
        "album_artist": str(changes.get("album_artist", "")).strip(),
        "genre": str(changes.get("genre", "")).strip(),
        "year": str(changes.get("year", "")).strip(),
        "track": str(changes.get("track", "")).strip(),
    }
    if not values["title"]:
        raise ValueError("Title cannot be empty")
    try:
        if values["year"]:
            values["year"] = str(max(0, min(9999, int(values["year"]))))
        if values["track"]:
            values["track"] = str(max(0, min(9999, int(values["track"]))))
    except ValueError as exc:
        raise ValueError("Year and track number must be whole numbers") from exc

    keys = {
        "title": "title", "artist": "artist", "album": "album",
        "album_artist": "albumartist", "genre": "genre", "year": "date",
        "track": "tracknumber",
    }
    try:
        for field, key in keys.items():
            if values[field]:
                audio.tags[key] = [values[field]]
            else:
                audio.tags.pop(key, None)
        audio.save()
    except (KeyError, TypeError, NotImplementedError, MutagenError) as exc:
        raise ValueError("This audio format does not support editing these tags") from exc


@app.patch("/api/track/<track_id>")
def update_track(track_id):
    track = _track(track_id)
    if not track:
        abort(404)
    payload = request.get_json(silent=True) or {}
    path = (MUSIC_DIR / track["path"]).resolve()
    if not path.is_relative_to(MUSIC_DIR) or not path.is_file():
        abort(404)
    try:
        _write_metadata(path, payload)
    except (OSError, ValueError, TypeError, MutagenError) as exc:
        return jsonify({"error": str(exc)}), 422
    scan_library()
    return jsonify({"track": _track(track_id)})


@app.get("/stream/<track_id>")
def stream(track_id):
    track = _track(track_id)
    if not track:
        abort(404)
    path = (MUSIC_DIR / track["path"]).resolve()
    if not path.is_relative_to(MUSIC_DIR) or not path.is_file():
        abort(404)
    mimetype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return send_file(path, mimetype=mimetype, conditional=True, as_attachment=False, download_name=path.name)


@app.get("/artwork/<track_id>")
def artwork(track_id):
    track = _track(track_id)
    if not track:
        abort(404)
    path = (MUSIC_DIR / track["path"]).resolve()
    if not path.is_relative_to(MUSIC_DIR) or not path.is_file():
        abort(404)
    try:
        audio = MutagenFile(path)
        image_data = None
        image_type = "image/jpeg"
        if audio:
            pictures = getattr(audio, "pictures", None)
            if pictures:
                image_data = pictures[0].data
                image_type = pictures[0].mime or image_type
            tags = getattr(audio, "tags", None)
            if not image_data and tags:
                for value in tags.values():
                    if isinstance(value, APIC):
                        image_data, image_type = value.data, value.mime
                        break
                if not image_data:
                    covr = tags.get("covr")
                    if covr:
                        image_data = bytes(covr[0])
                        image_type = "image/png" if image_data.startswith(b"\x89PNG") else "image/jpeg"
        if image_data:
            from flask import Response
            return Response(image_data, mimetype=image_type, headers={"Cache-Control": "public, max-age=86400"})
    except (OSError, ValueError, TypeError):
        pass
    abort(404)


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))

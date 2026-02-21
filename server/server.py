import os
import re
import json
import gzip
import time
import uuid
import threading
from copy import deepcopy
from collections import deque

import google.generativeai as genai
import dotenv
import psycopg2
from psycopg2 import OperationalError
from flask_cors import CORS
from pgvector.psycopg2 import register_vector
from sentence_transformers import SentenceTransformer
from flask import Flask, Response, request, make_response, jsonify

from config import ENVIRONMENT, IS_LOCAL, API_HOST, API_PORT, get_database_url


dotenv.load_dotenv()
app = Flask(__name__)


def _parse_cors_origins(value: str):
    raw = (value or "*").strip()
    if raw == "*":
        return "*"

    parts = [item.strip() for item in raw.split(",") if item.strip()]
    return parts or "*"


cors_origins = _parse_cors_origins(os.getenv("CORS_ORIGINS", "*"))
CORS(
    app,
    resources={r"/*": {"origins": cors_origins}},
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


class RollingWindowStats:
    def __init__(self, size: int = 200):
        self.size = max(20, size)
        self._lock = threading.Lock()
        self.total_ms = deque(maxlen=self.size)
        self.db_ms = deque(maxlen=self.size)
        self.serialization_ms = deque(maxlen=self.size)

    @staticmethod
    def _percentile(values, p):
        if not values:
            return None
        ordered = sorted(values)
        if len(ordered) == 1:
            return float(ordered[0])
        rank = int(round((p / 100.0) * (len(ordered) - 1)))
        rank = max(0, min(rank, len(ordered) - 1))
        return float(ordered[rank])

    def add(self, total_ms: float, db_ms: float, serialization_ms: float):
        with self._lock:
            self.total_ms.append(total_ms)
            self.db_ms.append(db_ms)
            self.serialization_ms.append(serialization_ms)

    def snapshot(self):
        with self._lock:
            total = list(self.total_ms)
            db = list(self.db_ms)
            serialization = list(self.serialization_ms)

        return {
            "count": len(total),
            "total_p50_ms": self._percentile(total, 50),
            "total_p95_ms": self._percentile(total, 95),
            "db_p50_ms": self._percentile(db, 50),
            "db_p95_ms": self._percentile(db, 95),
            "serialization_p50_ms": self._percentile(serialization, 50),
            "serialization_p95_ms": self._percentile(serialization, 95),
        }


rolling_stats = RollingWindowStats(int(os.getenv("SV_STATS_WINDOW", "200")))


def _new_request_id():
    return uuid.uuid4().hex[:12]


def _json_error(error_code: str, message: str, status: int, request_id: str):
    return (
        jsonify({"error": error_code, "message": message, "request_id": request_id}),
        status,
    )


def _normalize_sentence_tokens(sentence: str):
    cleaned = (sentence or "").lower().strip()
    cleaned = re.sub(r"\buh\b", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned.split() if cleaned else []


def _lookup_best_sign(cur, token: str):
    token_lc = token.lower()
    cur.execute(
        "SELECT id, word FROM public.signs WHERE lower(word) = %s LIMIT 1",
        (token_lc,),
    )
    exact_row = cur.fetchone()
    if exact_row:
        return {
            "sign_id": str(exact_row[0]),
            "word": exact_row[1],
            "match": "exact_word",
        }

    embedding = embedding_model.encode(token, normalize_embeddings=True)
    cur.execute(
        "SELECT id, word FROM public.signs ORDER BY embedding <=> %s ASC LIMIT 1",
        (embedding,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        "sign_id": str(row[0]),
        "word": row[1],
        "match": "vector_nn",
    }


def _ensure_light_indexes(conn):
    cur = conn.cursor()
    try:
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_signs_word_lower ON public.signs (lower(word))"
        )
        cur.execute(
            "SELECT to_regclass('public.idx_signs_word_lower') IS NOT NULL AS word_idx_exists, EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.signs'::regclass AND contype='p') AS id_pk_exists"
        )
        status = cur.fetchone()
        conn.commit()
        app.logger.info(
            "[db/index] word_idx_exists=%s id_pk_exists=%s",
            bool(status[0]) if status else False,
            bool(status[1]) if status else False,
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            cur.close()
        except Exception:
            pass


def _has_frame_count_column(cur):
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='signs' AND column_name='frame_count')"
    )
    row = cur.fetchone()
    return bool(row[0]) if row else False


def _build_json_response(payload: dict, request_id: str, total_ms: float):
    t_ser0 = time.perf_counter()
    payload_json = json.dumps(payload)
    payload_bytes = payload_json.encode("utf8")
    t_ser1 = time.perf_counter()
    serialization_ms = (t_ser1 - t_ser0) * 1000.0

    response = make_response(payload_json)
    response.headers["Content-Type"] = "application/json"
    response.headers["Content-length"] = str(len(payload_bytes))
    response.headers["X-Request-Id"] = request_id
    response.headers["X-Response-Time-Ms"] = f"{total_ms:.1f}"
    response.headers["X-Response-Size-Bytes"] = str(len(payload_bytes))
    return response, serialization_ms, len(payload_bytes)


def _log_route_timing(route_name: str, request_id: str, total_ms: float, db_ms: float, serialization_ms: float, payload_bytes: int, extra=None):
    details = extra or {}
    app.logger.info(
        "[%s] id=%s total=%.1fms db=%.1fms serialize=%.1fms payload=%dB %s",
        route_name,
        request_id,
        total_ms,
        db_ms,
        serialization_ms,
        payload_bytes,
        " ".join(f"{k}={v}" for k, v in details.items()),
    )


def _default_sslmode(host: str) -> str:
    if host in {"localhost", "127.0.0.1", ""}:
        return "disable"
    return "require"


def _connect_db():
    database_url = get_database_url()
    if database_url:
        conn = psycopg2.connect(
            database_url,
            connect_timeout=int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
        )
        register_vector(conn)
        _ensure_light_indexes(conn)
        return conn

    host = os.getenv("DB_HOST", "localhost")
    port = int(os.getenv("DB_PORT", "5432"))
    database = os.getenv("DB_NAME", "poses")
    user = os.getenv("DB_USER", "postgres")
    explicit_password = os.getenv("DB_PASSWORD")
    if explicit_password:
        password = explicit_password
    else:
        is_local = host in {"localhost", "127.0.0.1", ""}
        # Supabase pooler users look like: postgres.<project_ref>
        looks_like_supabase = ("supabase" in host) or user.startswith("postgres.")
        if (not is_local) or looks_like_supabase:
            password = os.getenv("SUPABASE_PASSWORD") or os.getenv("POSTGRES_PASSWORD")
        else:
            password = os.getenv("POSTGRES_PASSWORD")

    sslmode = os.getenv("DB_SSLMODE") or _default_sslmode(host)

    conn = psycopg2.connect(
        database=database,
        host=host,
        user=user,
        password=password,
        port=port,
        sslmode=sslmode,
        connect_timeout=int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
    )
    register_vector(conn)
    _ensure_light_indexes(conn)
    return conn


db = None


def get_db():
    global db
    if db is None:
        db = _connect_db()
        return db
    try:
        # psycopg2 sets .closed to 0 when open
        if getattr(db, "closed", 1) != 0:
            db = _connect_db()
    except Exception:
        db = _connect_db()
    return db


def _with_db_cursor(fn):
    """Run `fn(cur)` with a healthy cursor; reconnect once on connection errors."""
    conn = get_db()
    try:
        cur = conn.cursor()
        try:
            return fn(cur)
        finally:
            try:
                cur.close()
            except Exception:
                pass
    except OperationalError:
        # Reconnect once if Supabase/pooler dropped the connection.
        global db
        db = _connect_db()
        cur = db.cursor()
        try:
            return fn(cur)
        finally:
            try:
                cur.close()
            except Exception:
                pass
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
# Configure Google Gemini for ASL rephrasing (replace OpenAI)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
gemini_model = None
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    # Try preferred model first, then fall back to known-good ones
    candidates = [
        "gemini-2.5-flash",
        "gemini-1.5-flash-8b",
        "gemini-1.5-pro",
    ]
    for name in candidates:
        try:
            gemini_model = genai.GenerativeModel(name)
            print(f"[info] Using Gemini model: {name}")
            break
        except Exception as e:
            print(f"[warn] Gemini model init failed for {name}: {e}")


fingerspelling = {}
for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    base_dir = os.path.dirname(__file__)
    file_path = os.path.join(base_dir, "data", "alphabets", f"{letter}.json")
    with open(file_path, "r") as file:
        fingerspelling[letter] = json.load(file)


def interpolate_landmarks(start_landmark, end_landmark, ratio):

    interpolated_landmarks = []

    if start_landmark is None or end_landmark is None:
        return None

    for i in range(len(start_landmark)):
        if start_landmark[i] is None or end_landmark[i] is None:
            interpolated_landmarks.append(None)
        else:
            interpolated_landmark = {
                "x": start_landmark[i]["x"]
                + (end_landmark[i]["x"] - start_landmark[i]["x"]) * ratio,
                "y": start_landmark[i]["y"]
                + (end_landmark[i]["y"] - start_landmark[i]["y"]) * ratio,
                "z": start_landmark[i]["z"]
                + (end_landmark[i]["z"] - start_landmark[i]["z"]) * ratio,
                "visibility": start_landmark[i]["visibility"],
            }
            interpolated_landmarks.append(interpolated_landmark)

    return interpolated_landmarks


@app.after_request
def add_cors_pna_headers(response):
    # Ensure Private Network Access and common CORS headers for browser requests
    response.headers.setdefault("Access-Control-Allow-Origin", "*")
    response.headers.setdefault(
        "Access-Control-Allow-Headers", "Content-Type, Authorization"
    )
    response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    # Allow browser clients (extension) to read timing headers.
    response.headers.setdefault(
        "Access-Control-Expose-Headers",
        "Server-Timing, X-Response-Time-Ms, X-Request-Id, X-Response-Size-Bytes, X-Response-Compressed-Bytes",
    )
    # Chrome PNA requirement when calling 127.0.0.1 from a public context
    response.headers.setdefault("Access-Control-Allow-Private-Network", "true")
    return response


@app.route("/pose", methods=["POST"])
def pose():

    request_id = uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    log_timings = os.getenv("SV_LOG_TIMINGS", "1") == "1"

    t_parse0 = time.perf_counter()

    data = request.get_json()
    words = data.get("words", "").lower().strip()
    animations = []

    t_parse1 = time.perf_counter()

    if not words:
        return Response(status=400)

    if words != "hello":
        if gemini_model is not None:
            t_gem0 = time.perf_counter()
            try:
                prompt = (
                    "Convert the following English phrase into ASL Gloss grammar. "
                    "Do not change meaning or move periods. Follow ASL grammar order: "
                    "object, then subject, then verb. Remove forms like IS/ARE not present in "
                    "ASL. Replace I with ME. Do not add classifiers. Output only the "
                    "rephrased phrase with no extra text.\n\n"
                    f"Phrase: {words}"
                )
                resp = gemini_model.generate_content(prompt)
                if hasattr(resp, "text") and resp.text:
                    words = resp.text.strip()
            except Exception as e:
                # Graceful degradation: if Gemini fails (e.g., rate limit), proceed without rephrasing
                app.logger.warning(f"Gemini rephrase failed: {e}")
            finally:
                t_gem1 = time.perf_counter()
        else:
            app.logger.warning("GEMINI_API_KEY not set; skipping ASL conversion")

    words = re.sub(r"\buh\b", "", words)

    print(words)
    words = words.split()

    # Running frame counter to assign frame indices consistently
    frame_counter = 0

    t_embed_total = 0.0
    t_db_total = 0.0
    t_build_total = 0.0

    def run_query(cur):
        nonlocal frame_counter, t_embed_total, t_db_total, t_build_total

        for word in words:
            # Normalize embeddings to make cosine distance meaningful
            t_e0 = time.perf_counter()
            embedding = embedding_model.encode(word, normalize_embeddings=True)
            t_e1 = time.perf_counter()
            t_embed_total += t_e1 - t_e0

            t_q0 = time.perf_counter()
            cur.execute(
                "SELECT word, poses, (embedding <=> %s) AS cosine_distance FROM public.signs ORDER BY cosine_distance ASC LIMIT 1",
                (embedding,),
            )
            result = cur.fetchone()
            t_q1 = time.perf_counter()
            t_db_total += t_q1 - t_q0

            t_b0 = time.perf_counter()
            animation = []

            # Use cosine distance threshold (lower = more similar). Fallback if too far or missing.
            distance = float(result[2]) if result and result[2] is not None else None
            use_fingerspell = True if distance is None else distance > 0.25  # similarity < ~0.75

            if use_fingerspell:
                # Build frames from cached A–Z without mutating the cache
                for letter in re.sub(r"[^A-Z]", "", word.upper()):
                    frames = fingerspelling.get(letter)
                    if not frames:
                        continue
                    letter_frames = deepcopy(frames)
                    for f in letter_frames:
                        f["word"] = f"fs-{word.upper()}"
                    animation.extend(letter_frames)
            else:
                # Also deepcopy DB frames before tagging
                sign_frames = deepcopy(result[1]) if result and result[1] else []
                for f in sign_frames:
                    f["word"] = result[0] if result else word
                animation.extend(sign_frames)

            previous_frame = animations[-1] if animations else None

            if previous_frame and animation:
                next_frame = animation[0]
                for i in range(5):
                    ratio = i / 5
                    interpolated_frame = {
                        "frame": frame_counter,
                        "word": previous_frame.get("word", ""),
                        "pose_landmarks": interpolate_landmarks(
                            previous_frame.get("pose_landmarks"),
                            next_frame.get("pose_landmarks"),
                            ratio,
                        ),
                        "left_hand_landmarks": interpolate_landmarks(
                            previous_frame.get("left_hand_landmarks"),
                            next_frame.get("left_hand_landmarks"),
                            ratio,
                        ),
                        "right_hand_landmarks": interpolate_landmarks(
                            previous_frame.get("right_hand_landmarks"),
                            next_frame.get("right_hand_landmarks"),
                            ratio,
                        ),
                        "face_landmarks": interpolate_landmarks(
                            previous_frame.get("face_landmarks"),
                            next_frame.get("face_landmarks"),
                            ratio,
                        ),
                    }
                    animations.append(interpolated_frame)
                    frame_counter += 1

            # Normalize and append frames from the selected animation
            for f in animation:
                normalized = {
                    "frame": frame_counter,
                    "word": f.get("word", result[0] if result and result[0] else word),
                    "pose_landmarks": f.get("pose_landmarks"),
                    "left_hand_landmarks": f.get("left_hand_landmarks"),
                    "right_hand_landmarks": f.get("right_hand_landmarks"),
                    "face_landmarks": f.get("face_landmarks"),
                }
                animations.append(normalized)
                frame_counter += 1

            t_b1 = time.perf_counter()
            t_build_total += t_b1 - t_b0

    try:
        _with_db_cursor(run_query)
    except Exception as e:
        app.logger.exception("DB query failed")
        app.logger.error(f"Query error details: {e}", exc_info=True)
        return jsonify({"error": "db_query_failed", "message": str(e)}), 500

    t_ser0 = time.perf_counter()
    payload_json = json.dumps(animations)
    payload_bytes = payload_json.encode("utf8")
    t_ser1 = time.perf_counter()

    t_gz0 = time.perf_counter()
    content = gzip.compress(payload_bytes, 5)
    t_gz1 = time.perf_counter()

    t1 = time.perf_counter()
    total_ms = (t1 - t0) * 1000.0
    parse_ms = (t_parse1 - t_parse0) * 1000.0
    embed_ms = t_embed_total * 1000.0
    db_ms = t_db_total * 1000.0
    build_ms = t_build_total * 1000.0
    serialization_ms = (t_ser1 - t_ser0) * 1000.0
    gzip_ms = (t_gz1 - t_gz0) * 1000.0
    payload_size_bytes = len(payload_bytes)
    compressed_size_bytes = len(content)

    rolling_stats.add(total_ms, db_ms, serialization_ms)
    stats_snapshot = rolling_stats.snapshot()

    gem_ms = None
    try:
        gem_ms = (t_gem1 - t_gem0) * 1000.0  # type: ignore[name-defined]
    except Exception:
        gem_ms = None

    response = make_response(content)
    response.headers["Content-length"] = len(content)
    response.headers["Content-Encoding"] = "gzip"
    response.headers.setdefault("Content-Type", "application/json")

    response.headers["X-Request-Id"] = request_id
    response.headers["X-Response-Time-Ms"] = f"{total_ms:.1f}"
    response.headers["X-Response-Size-Bytes"] = str(payload_size_bytes)
    response.headers["X-Response-Compressed-Bytes"] = str(compressed_size_bytes)
    server_timing_parts = [
        f"total;dur={total_ms:.1f}",
        f"parse;dur={parse_ms:.1f}",
    ]
    if gem_ms is not None:
        server_timing_parts.append(f"gemini;dur={gem_ms:.1f}")
    server_timing_parts.extend(
        [
            f"embed;dur={embed_ms:.1f}",
            f"db;dur={db_ms:.1f}",
            f"build;dur={build_ms:.1f}",
            f"serialize;dur={serialization_ms:.1f}",
            f"gzip;dur={gzip_ms:.1f}",
        ]
    )
    response.headers["Server-Timing"] = ", ".join(server_timing_parts)

    if log_timings:
        app.logger.info(
            "[pose] id=%s words=%d frames=%d total=%.1fms parse=%.1fms gemini=%sms embed=%.1fms db=%.1fms build=%.1fms serialize=%.1fms gzip=%.1fms payload=%dB compressed=%dB rolling(count=%d,total_p50=%.1f,total_p95=%.1f,db_p50=%.1f,db_p95=%.1f,ser_p50=%.1f,ser_p95=%.1f)",
            request_id,
            len(words),
            len(animations),
            total_ms,
            parse_ms,
            f"{gem_ms:.1f}" if gem_ms is not None else "-",
            embed_ms,
            db_ms,
            build_ms,
            serialization_ms,
            gzip_ms,
            payload_size_bytes,
            compressed_size_bytes,
            stats_snapshot["count"],
            stats_snapshot["total_p50_ms"] or 0.0,
            stats_snapshot["total_p95_ms"] or 0.0,
            stats_snapshot["db_p50_ms"] or 0.0,
            stats_snapshot["db_p95_ms"] or 0.0,
            stats_snapshot["serialization_p50_ms"] or 0.0,
            stats_snapshot["serialization_p95_ms"] or 0.0,
        )

    return response


@app.route("/pose/sentence", methods=["POST"])
def pose_sentence():
    request_id = _new_request_id()
    t0 = time.perf_counter()
    db_ms = 0.0

    data = request.get_json(silent=True) or {}
    sentence = data.get("sentence", "")
    tokens = _normalize_sentence_tokens(sentence)
    if not tokens:
        return _json_error(
            "invalid_request",
            "`sentence` is required and must contain at least one token.",
            400,
            request_id,
        )

    def run_query(cur):
        nonlocal db_ms
        signs = []
        exact_matches = 0
        vector_matches = 0
        for token in tokens:
            t_q0 = time.perf_counter()
            sign = _lookup_best_sign(cur, token)
            t_q1 = time.perf_counter()
            db_ms += (t_q1 - t_q0) * 1000.0
            if sign is None:
                signs.append({"sign_id": None, "word": token})
            else:
                if sign.get("match") == "exact_word":
                    exact_matches += 1
                elif sign.get("match") == "vector_nn":
                    vector_matches += 1
                signs.append({"sign_id": sign["sign_id"], "word": sign["word"]})
        return signs, exact_matches, vector_matches

    try:
        signs, exact_matches, vector_matches = _with_db_cursor(run_query)
    except Exception as e:
        app.logger.exception("/pose/sentence db query failed")
        return _json_error("db_query_failed", str(e), 500, request_id)

    total_ms = (time.perf_counter() - t0) * 1000.0
    payload = {
        "signs": signs,
        "request_id": request_id,
        "timings": {
            "total_ms": round(total_ms, 1),
            "db_ms": round(db_ms, 1),
        },
    }
    response, serialization_ms, payload_bytes = _build_json_response(
        payload, request_id, total_ms
    )
    response.headers["Server-Timing"] = (
        f"total;dur={total_ms:.1f}, db;dur={db_ms:.1f}, serialize;dur={serialization_ms:.1f}"
    )
    _log_route_timing(
        "pose/sentence",
        request_id,
        total_ms,
        db_ms,
        serialization_ms,
        payload_bytes,
        {
            "tokens": len(tokens),
            "signs": len(signs),
            "query_shape": "SELECT id, word",
            "exact_matches": exact_matches,
            "vector_matches": vector_matches,
        },
    )
    return response


@app.route("/pose/word/<sign_id>", methods=["GET"])
def pose_word(sign_id):
    request_id = _new_request_id()
    t0 = time.perf_counter()
    db_ms = 0.0

    if not str(sign_id).isdigit():
        return _json_error(
            "invalid_sign_id",
            "`sign_id` must be a numeric string.",
            400,
            request_id,
        )

    numeric_sign_id = int(sign_id)

    def run_query(cur):
        nonlocal db_ms
        has_frame_count = _has_frame_count_column(cur)
        t_q0 = time.perf_counter()
        if has_frame_count:
            cur.execute(
                "SELECT id, word, frame_count FROM public.signs WHERE id = %s",
                (numeric_sign_id,),
            )
        else:
            cur.execute(
                "SELECT id, word, NULL::integer AS frame_count FROM public.signs WHERE id = %s",
                (numeric_sign_id,),
            )
        row = cur.fetchone()
        t_q1 = time.perf_counter()
        db_ms += (t_q1 - t_q0) * 1000.0
        return row, has_frame_count

    try:
        row, has_frame_count = _with_db_cursor(run_query)
    except Exception as e:
        app.logger.exception("/pose/word db query failed")
        return _json_error("db_query_failed", str(e), 500, request_id)

    if not row:
        return _json_error(
            "not_found",
            f"No sign found for sign_id={sign_id}.",
            404,
            request_id,
        )

    total_ms = (time.perf_counter() - t0) * 1000.0
    payload = {
        "sign_id": str(row[0]),
        "word": row[1],
        "frame_count": int(row[2]) if row[2] is not None else None,
        "has_pose": True,
        "request_id": request_id,
        "timings": {
            "total_ms": round(total_ms, 1),
            "db_ms": round(db_ms, 1),
        },
    }
    response, serialization_ms, payload_bytes = _build_json_response(
        payload, request_id, total_ms
    )
    response.headers["Server-Timing"] = (
        f"total;dur={total_ms:.1f}, db;dur={db_ms:.1f}, serialize;dur={serialization_ms:.1f}"
    )
    _log_route_timing(
        "pose/word",
        request_id,
        total_ms,
        db_ms,
        serialization_ms,
        payload_bytes,
        {
            "sign_id": sign_id,
            "frame_count": payload["frame_count"],
            "frame_count_source": "column" if has_frame_count else "unavailable",
            "query_shape": "SELECT id, word, frame_count",
        },
    )
    return response




if __name__ == "__main__":
    app.logger.info("[startup] environment=%s local=%s", ENVIRONMENT, IS_LOCAL)
    host = API_HOST
    port = API_PORT
    app.run(host=host, port=port)


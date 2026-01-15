import os
import re
import json
import gzip
import time
import uuid
from copy import deepcopy

import google.generativeai as genai
import dotenv
import psycopg2
from flask_cors import CORS
from pgvector.psycopg2 import register_vector
from sentence_transformers import SentenceTransformer
from flask import Flask, Response, request, make_response, jsonify


dotenv.load_dotenv()
app = Flask(__name__)
CORS(app)
db = psycopg2.connect(
    database="poses",
    host="localhost",
    user="postgres",
    password=os.getenv("POSTGRES_PASSWORD"),
    port=5432,
)
register_vector(db)
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
    file_path = os.path.join("data/alphabets", f"{letter}.json")
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
        "Server-Timing, X-Response-Time-Ms, X-Request-Id",
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

    cur = db.cursor()
    for word in words:
        # Normalize embeddings to make cosine distance meaningful
        t_e0 = time.perf_counter()
        embedding = embedding_model.encode(word, normalize_embeddings=True)
        t_e1 = time.perf_counter()
        t_embed_total += t_e1 - t_e0

        t_q0 = time.perf_counter()
        cur.execute(
            "SELECT word, poses, (embedding <=> %s) AS cosine_distance FROM signs ORDER BY cosine_distance ASC LIMIT 1",
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
                f["word"] = result[0]
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
                "word": f.get("word", result[0] if result else ""),
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
        cur.close()
    except Exception:
        pass

    t_gz0 = time.perf_counter()
    content = gzip.compress(json.dumps(animations).encode("utf8"), 5)
    t_gz1 = time.perf_counter()

    t1 = time.perf_counter()
    total_ms = (t1 - t0) * 1000.0
    parse_ms = (t_parse1 - t_parse0) * 1000.0
    embed_ms = t_embed_total * 1000.0
    db_ms = t_db_total * 1000.0
    build_ms = t_build_total * 1000.0
    gzip_ms = (t_gz1 - t_gz0) * 1000.0

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
            f"gzip;dur={gzip_ms:.1f}",
        ]
    )
    response.headers["Server-Timing"] = ", ".join(server_timing_parts)

    if log_timings:
        app.logger.info(
            "[pose] id=%s words=%d frames=%d total=%.1fms parse=%.1fms gemini=%sms embed=%.1fms db=%.1fms build=%.1fms gzip=%.1fms",
            request_id,
            len(words),
            len(animations),
            total_ms,
            parse_ms,
            f"{gem_ms:.1f}" if gem_ms is not None else "-",
            embed_ms,
            db_ms,
            build_ms,
            gzip_ms,
        )

    return response




if __name__ == "__main__":
    app.run()


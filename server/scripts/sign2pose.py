import os
import random
import cv2
import json
import dotenv
import psycopg2
from tqdm import tqdm
import mediapipe as mp
from pgvector.psycopg2 import register_vector
from sentence_transformers import SentenceTransformer

dotenv.load_dotenv()
db = psycopg2.connect(
    database="poses",
    host="localhost",
    user="postgres",
    password=os.getenv("POSTGRES_PASSWORD"),
    port=5432,
)
register_vector(db)
cur = db.cursor()

holistic_model = mp.solutions.holistic.Holistic()
embedding_model = SentenceTransformer("all-MiniLM-L6-v2")

# Dataset structure expected:
# ../data/videos/<word>/<many videos for that word>
VIDEOS_ROOT = os.path.join("..", "data", "videos")

# List all word directories under VIDEOS_ROOT
words_dirs = [
    d
    for d in os.listdir(VIDEOS_ROOT)
    if os.path.isdir(os.path.join(VIDEOS_ROOT, d))
]

bar = tqdm(total=len(words_dirs))


def landmarks_to_dict(landmarks):
    if landmarks is None:
        return None

    return [
        {"x": lm.x, "y": lm.y, "z": lm.z, "visibility": lm.visibility}
        for lm in landmarks.landmark
    ]


def interpolate_landmarks(start_landmarks, end_landmarks, ratio):
    interpolated_landmarks = {}
    for key in start_landmarks.keys():
        if start_landmarks[key] is not None and end_landmarks[key] is not None:
            interpolated_landmarks[key] = {
                "x": start_landmarks[key]["x"]
                + (end_landmarks[key]["x"] - start_landmarks[key]["x"])
                * ratio,
                "y": start_landmarks[key]["y"]
                + (end_landmarks[key]["y"] - start_landmarks[key]["y"])
                * ratio,
                "z": start_landmarks[key]["z"]
                + (end_landmarks[key]["z"] - start_landmarks[key]["z"])
                * ratio,
            }
        elif start_landmarks[key] is not None:
            interpolated_landmarks[key] = start_landmarks[key]
        else:
            interpolated_landmarks[key] = end_landmarks[key]
    return interpolated_landmarks


try:
    cur.execute("SELECT word FROM signs")
    words = cur.fetchall()

    for i, word in enumerate(words_dirs):
        try:
            bar.update(1)
            # Skip if this word is already processed
            if (word,) in words:
                continue

            # Gather candidate videos inside the word directory
            word_dir = os.path.join(VIDEOS_ROOT, word)
            allowed_exts = (".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v")
            candidates = [
                f
                for f in os.listdir(word_dir)
                if os.path.isfile(os.path.join(word_dir, f))
                and os.path.splitext(f)[1].lower() in allowed_exts
            ]

            if not candidates:
                # No valid video files for this word, skip
                continue

            # Pick any one at random
            chosen_file = random.choice(candidates)
            video = os.path.join(word_dir, chosen_file)

            data = []
            capture = cv2.VideoCapture(video)
            frame_number = 0
            while capture.isOpened():
                success, frame = capture.read()

                if not success:
                    break

                frame = cv2.resize(frame, (640, 480))
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                holistic_results = holistic_model.process(frame_rgb)

                holistic_results_dict = {
                    "frame": frame_number,
                    "pose_landmarks": landmarks_to_dict(
                        holistic_results.pose_landmarks
                    ),
                    "left_hand_landmarks": landmarks_to_dict(
                        holistic_results.left_hand_landmarks
                    ),
                    "right_hand_landmarks": landmarks_to_dict(
                        holistic_results.right_hand_landmarks
                    ),
                    "face_landmarks": landmarks_to_dict(
                        holistic_results.face_landmarks
                    ),
                }

                data.append(holistic_results_dict)
                frame_number += 1

            capture.release()
            interpolated_data = []
            for i in range(len(data) - 1):
                current_frame = data[i]
                next_frame = data[i + 1]

                interpolated_data.append(current_frame)

                if next_frame["frame"] - current_frame["frame"] > 1:
                    gap = next_frame["frame"] - current_frame["frame"]

                    for j in range(1, gap):
                        interpolation_ratio = j / gap

                        interpolated_frame = {
                            "frame": current_frame["frame"] + j,
                            "pose_landmarks": interpolate_landmarks(
                                current_frame["pose_landmarks"],
                                next_frame["pose_landmarks"],
                                interpolation_ratio,
                            ),
                            "left_hand_landmarks": interpolate_landmarks(
                                current_frame["left_hand_landmarks"],
                                next_frame["left_hand_landmarks"],
                                interpolation_ratio,
                            ),
                            "right_hand_landmarks": interpolate_landmarks(
                                current_frame["right_hand_landmarks"],
                                next_frame["right_hand_landmarks"],
                                interpolation_ratio,
                            ),
                            "face_landmarks": interpolate_landmarks(
                                current_frame["face_landmarks"],
                                next_frame["face_landmarks"],
                                interpolation_ratio,
                            ),
                        }

                        interpolated_data.append(interpolated_frame)
            interpolated_data.append(data[-1])

            embedding = embedding_model.encode(word)

            try:
                cur.execute(
                    "INSERT INTO signs (word, poses, embedding) VALUES (%s, %s, %s)",
                    (word, json.dumps(data), embedding),
                )
                db.commit()
            except Exception as e:
                print(e)
                db.rollback()
                continue
        except Exception as e:
            print(e)
            continue
except Exception as e:
    print(e)

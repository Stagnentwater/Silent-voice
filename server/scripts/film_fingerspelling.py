import os
import cv2
import json
import dotenv
import mediapipe as mp

dotenv.load_dotenv()
holistic_model = mp.solutions.holistic.Holistic()

data = []
frame_number = 0
capture = cv2.VideoCapture(1)


def landmarks_to_dict(landmarks):
    if landmarks is None:
        return None

    return [
        {"x": lm.x, "y": lm.y, "z": lm.z, "visibility": lm.visibility}
        for lm in landmarks.landmark
    ]


while capture.isOpened():
    success, frame = capture.read()

    if not success:
        break

    frame = cv2.resize(frame, (640, 480))
    frame = cv2.flip(frame, 1)

    frame_number += 1

    if frame_number == 50:
        print("Started Recording")
    elif frame_number == 70:
        print("Stopped Recording")
        break
    else:
        print(frame_number)

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    holistic_results = holistic_model.process(frame_rgb)

    holistic_results_dict = {
        "frame": frame_number,
        "pose_landmarks": landmarks_to_dict(holistic_results.pose_landmarks),
        "left_hand_landmarks": landmarks_to_dict(
            holistic_results.left_hand_landmarks
        ),
        "right_hand_landmarks": landmarks_to_dict(
            holistic_results.right_hand_landmarks
        ),
        "face_landmarks": landmarks_to_dict(holistic_results.face_landmarks),
    }

    if frame_number >= 50 and frame_number <= 70:
        data.append(holistic_results_dict)

    cv2.imshow("frame", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

capture.release()

letter = input("Enter the letter: ")
path = os.path.join("../data/alphabets", f"{letter}.json")
with open(path, "w") as file:
    json.dump(data, file)
    print(f"Data saved to {path}")

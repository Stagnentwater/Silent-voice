import {
  HAND_CONNECTIONS,
  POSE_CONNECTIONS,
  FACEMESH_TESSELATION,
} from "@mediapipe/holistic";
import { useEffect, useState, useRef } from "react";
import { drawConnectors } from "@mediapipe/drawing_utils";

import { type Point } from "@/app/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function Avatar({ poses }: { poses: any[] }) {
  const canvasRef = useRef(null);
  const [word, setWord] = useState<string>("");
  const [signing, setSigning] = useState<boolean>(false);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    setSigning(true);
    let frameIndex = 0;

    const drawFrame = () => {
      if (frameIndex >= poses.length) {
        setSigning(false);
        return;
      }

      const landmark = poses[frameIndex];
      setWord(landmark.word);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (landmark.pose_landmarks) {
        const filteredPoseLandmarks = landmark.pose_landmarks.filter(
          (point: Point, index: number) =>
            ![17, 18, 19, 20, 21, 22].includes(index),
        );

        const filteredPoseConnections = POSE_CONNECTIONS.filter(
          (connection) =>
            ![17, 18, 19, 20, 21, 22].includes(connection[0]) &&
            ![17, 18, 19, 20, 21, 22].includes(connection[1]),
        );

        drawConnectors(ctx, filteredPoseLandmarks, filteredPoseConnections, {
          color: "#00FF00",
          lineWidth: 2,
        });
      }

      if (landmark.face_landmarks) {
        landmark.face_landmarks.forEach((point: Point) => {
          point.visibility = 1;
        });

        drawConnectors(ctx, landmark.face_landmarks, FACEMESH_TESSELATION, {
          color: "#00FF00",
          lineWidth: 0.5,
        });
      }

      if (landmark.right_hand_landmarks) {
        landmark.right_hand_landmarks.forEach((point: Point) => {
          point.visibility = 1;
        });

        drawConnectors(ctx, landmark.right_hand_landmarks, HAND_CONNECTIONS, {
          color: "#00FF00",
          lineWidth: 2,
        });
      }

      if (landmark.left_hand_landmarks) {
        landmark.left_hand_landmarks.forEach((point: Point) => {
          point.visibility = 1;
        });

        drawConnectors(ctx, landmark.left_hand_landmarks, HAND_CONNECTIONS, {
          color: "#00FF00",
          lineWidth: 2,
        });
      }

      frameIndex++;
      requestAnimationFrame(drawFrame);
    };

    requestAnimationFrame(drawFrame);
  }, [poses]);

  return (
    <div className="flex h-full w-full flex-1 flex-col items-center justify-between bg-neutral-900 py-4">
      <div className="flex w-full flex-col items-center gap-6">
        <p className="text-4xl font-bold text-white">Sign Language</p>
        <div
          className={`relative h-[543.63px] w-full border-8 border-l-4 ${
            signing ? "border-[#00FF00]" : "border-neutral-200"
          }`}
        >
          <canvas ref={canvasRef} width="640" height="480"></canvas>
          <Word word={word} />
        </div>
      </div>
      <div className="flex flex-col">
        <p className="text-gray-400">
          Avatar translates to ASL gloss and signs!
        </p>
      </div>
    </div>
  );
}

function Word({ word }: { word: string }) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 transform text-2xl font-medium text-[#FF0000]">
      <p>{word}</p>
    </div>
  );
}

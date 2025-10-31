"use client";

import React, { useEffect, useState, useRef } from "react";

export default function VideoRecorder({
  transcript,
  fetchTranscript,
}: {
  transcript: string;
  fetchTranscript: (blob: Blob) => void;
}) {
  const [recording, setRecording] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    const initWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing webcam.", err);
      }
    };

    initWebcam();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, []);

  const startRecording = () => {
    if (!videoRef.current || !videoRef.current.srcObject) return;

    const stream = videoRef.current.srcObject as MediaStream;
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "video/mp4",
    });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      chunks.current.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks.current, { type: "video/mp4" });
      chunks.current = [];

      if (!blob) return;
      fetchTranscript(blob);
    };

    mediaRecorder.start();
    setRecording(true);
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  return (
    <div className="flex flex-col h-full flex-1 w-full items-center justify-start py-4 bg-neutral-800">
      <div className="flex flex-col w-full h-full items-center gap-6">
        <p className="text-4xl text-white font-bold">Lip Sync</p>
        <div className="flex flex-col w-full gap-2">
          <div
            className={`flex flex-col w-full border-8 border-r-4 relative ${
              recording ? "border-red-500" : "border-neutral-200"
            }`}
          >
            {recording && (
              <div className="flash w-8 h-8 rounded-full bg-red-500 top-4 right-4 absolute" />
            )}
            <video
              autoPlay
              playsInline
              ref={videoRef}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            {!recording ? (
              <button
                onClick={startRecording}
                className="w-full flex items-center justify-center py-4 bg-neutral-300 rounded hover:bg-neutral-200 transition duration-300"
              >
                <p className="text-black text-2xl font-bold">Start Recording</p>
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="w-full flex items-center justify-center py-4 bg-red-500 rounded hover:bg-red-600 transition duration-300"
              >
                <p className="text-white text-2xl font-bold">Stop Recording</p>
              </button>
            )}
          </div>
          {transcript && (
            <div className="w-full bg-neutral-800 p-4">
              <p>{transcript}</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col">
        <p className="text-gray-400">Simply mouth out what you want to say!</p>
      </div>
    </div>
  );
}

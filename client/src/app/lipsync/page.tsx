"use client";

import axios from "axios";
import { useState, useEffect } from "react";

import Avatar from "./components/Avatar";
import LipReader from "@/components/LipReader";

export default function LipPage() {
  const [loading, setLoading] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [poses, setPoses] = useState<any[]>([]);

  useEffect(() => {
    fetchPoses("hello");
  }, []);

  async function fetchTranscript(blob: Blob) {
    const formData = new FormData();
    formData.append("video", blob, "lipsync-video.mp4");

    setLoading(true);
    try {
      const response = await axios.post(
        "https://symphoniclabs--symphonet-vsr-modal-htn-model-upload-static-htn.modal.run",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );

      setTranscript(response.data);
      await fetchPoses(response.data);
    } catch (error) {
      console.error(error);
    }
  }

  async function fetchPoses(words: string) {
    const poseResponse = await axios.post("http://127.0.0.1:5000/pose", {
      words: words,
    });
    const landmarks = poseResponse.data;
    setPoses(landmarks);
    setLoading(false);
  }

  return (
    <div className="w-screen h-screen grid grid-cols-2 bg-black">
      {loading && (
        <div className="absolute top-0 z-10 left-0 w-full h-full bg-black bg-opacity-75 flex items-center justify-center">
          <div className="loading-icon"></div>
        </div>
      )}
      <LipReader transcript={transcript} fetchTranscript={fetchTranscript} />
      <Avatar poses={poses} />
    </div>
  );
}

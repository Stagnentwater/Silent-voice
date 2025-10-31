"use client";

export default function App() {
  return (
    <div className="flex h-screen w-screen flex-row gap-10 p-10">
      <div className="flex h-full w-1/2 flex-col gap-4 rounded-md border border-white border-opacity-10 p-10 transition duration-500 hover:border-opacity-20 hover:bg-white hover:bg-opacity-[0.01]">
        <img src="/engine.png" alt="Sign Engine" draggable="false" />
        <div className="flex w-full flex-col gap-4">
          <h1 className="text-4xl font-bold">Sign Engine</h1>
          <p className="text-lg text-white text-opacity-70">
            A modular API that produces American Sign Language (ASL) sequences
            from English text. It has a vocabulary of over 9,000 signs and uses
            semantic analysis to further increase the size of it&apos;s
            vocabulary.
          </p>
          <ul className="mt-4 flex list-inside list-decimal flex-col gap-3 text-lg text-white text-opacity-70">
            <li>
              Uses Google Mediapipe to to extract 3D poses from over 9,000 ASL
              videos
            </li>
            <li>
              Uses an embedding model when storing poses to allow for semantic
              search in the future
            </li>
            <li>Stores signs and poses in a PostgreSQL pgvector database</li>
            <li>
              Uses a finetuned GPT-4o-mini model to translate from English text
              to ASL gloss
            </li>
          </ul>
        </div>
      </div>
      <div className="grid flex-1 grid-rows-2 gap-10">
        <a
          href="/lipsync"
          target="_blank"
          className="flex h-full w-full flex-col gap-4 rounded-md border border-white border-opacity-10 p-10 transition duration-500 hover:border-opacity-20 hover:bg-white hover:bg-opacity-[0.01]"
        >
          <div className="flex items-center gap-4">
            <i className="fas fa-deaf text-4xl text-white" />
            <h1 className="text-4xl font-semibold">Lipreading → ASL</h1>
          </div>
          <p className="text-lg text-white text-opacity-70">
            A web interface that integrates Symphonic Labs and our Sign Engine
            to provide a seamless experience for users to simply mouth words and
            have them translated into ASL.
          </p>
          <ul className="mt-4 flex list-inside list-decimal flex-col gap-3 text-lg text-white text-opacity-70">
            <li>
              Uses Symphonic Labs&apos; API to transcribe lip movements into
              English text
            </li>
            <li>Uses Sign Engine to translate English text into ASL signs</li>
          </ul>
        </a>
        <a
          target="_blank"
          href="https://www.youtube.com/watch?v=xFFs9UgOAlE"
          className="flex h-full w-full flex-col gap-4 rounded-md border border-white border-opacity-10 p-10 transition duration-500 hover:border-opacity-20 hover:bg-white hover:bg-opacity-[0.01]"
        >
          <div className="flex items-center gap-4">
            <i className="fab fa-youtube text-4xl text-white" />
            <h1 className="text-4xl font-semibold">YouTube → ASL</h1>
          </div>
          <p className="text-lg text-white text-opacity-70">
            A Chrome extension that uses Sign Engine to interpret YouTube videos
            into ASL in real-time.
          </p>
          <ul className="mt-4 flex list-inside list-decimal flex-col gap-3 text-lg text-white text-opacity-70">
            <li>
              Uses YouTube&apos;s transcripts to extract English text from
              videos
            </li>
            <li>Uses Sign Engine to translate English text into ASL signs</li>
          </ul>
        </a>
      </div>
    </div>
  );
}

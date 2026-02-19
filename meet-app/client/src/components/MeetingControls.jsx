import { useState } from 'react';

export function MeetingControls({
  joinedRoom,
  connectionState,
  listening,
  speechSupported,
  onJoin,
  onLeave,
  onStartSpeech,
  onStopSpeech
}) {
  const [roomInput, setRoomInput] = useState('demo-room');

  return (
    <section className="panel controls-panel">
      <h2>SignMeet Room</h2>
      <p className="status-line">Connection: {connectionState}</p>
      {joinedRoom ? <p className="status-line">Active Room: {joinedRoom}</p> : null}

      <div className="controls-row">
        <input
          value={roomInput}
          onChange={(event) => setRoomInput(event.target.value)}
          placeholder="Enter room id"
          disabled={Boolean(joinedRoom)}
        />

        {!joinedRoom ? (
          <button type="button" onClick={() => onJoin(roomInput.trim())}>
            Join Room
          </button>
        ) : (
          <button type="button" className="danger" onClick={onLeave}>
            Leave Room
          </button>
        )}
      </div>

      <div className="controls-row">
        <button
          type="button"
          onClick={onStartSpeech}
          disabled={!joinedRoom || !speechSupported || listening}
        >
          Start Speech
        </button>
        <button
          type="button"
          onClick={onStopSpeech}
          disabled={!joinedRoom || !speechSupported || !listening}
        >
          Stop Speech
        </button>
      </div>

      {!speechSupported ? (
        <p className="warning">Web Speech API is unavailable in this browser.</p>
      ) : null}
    </section>
  );
}

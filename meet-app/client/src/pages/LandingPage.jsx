import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function LandingPage() {
  const navigate = useNavigate();
  const { user, logout, createRoom, joinRoom } = useAuth();
  const [error, setError] = useState('');
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [roomCode, setRoomCode] = useState('');

  async function handleCreateRoom() {
    setError('');
    setRoomNotFound(false);
    setLoading(true);
    try {
      const room = await createRoom();
      navigate(`/room/${room.roomCode}`, { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom() {
    setError('');
    setRoomNotFound(false);
    const normalizedCode = String(roomCode).trim().toUpperCase();
    if (!normalizedCode) {
      setError('Enter a room code to join.');
      return;
    }

    setLoading(true);
    try {
      const room = await joinRoom({ roomCode: normalizedCode });
      navigate(`/room/${room.roomCode}`, { replace: true });
    } catch (err) {
      const message = err.message || 'Failed to join room';
      if (message.toLowerCase().includes('room not found')) {
        setRoomNotFound(true);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="landing-min-shell">
      <header className="landing-min-header">
        <div className="landing-min-brand">SignMeet</div>
        <div className="landing-min-user">
          <span>{user?.username}</span>
          <button type="button" className="landing-min-logout" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <section className="landing-min-hero">
        <h1>Video calls and meetings for everyone</h1>
        <p>Connect, collaborate and communicate with SignMeet.</p>

        <div className="landing-min-actions">
          <button
            type="button"
            className="landing-min-create"
            onClick={handleCreateRoom}
            disabled={loading}
          >
            Create
          </button>

          <div className="landing-min-join-wrap">
            <input
              type="text"
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleJoinRoom();
                }
              }}
              placeholder="Enter a room code"
              disabled={loading}
              aria-label="Room code"
            />
            <button
              type="button"
              className="landing-min-join"
              onClick={handleJoinRoom}
              disabled={loading || !String(roomCode).trim()}
            >
              Join
            </button>
          </div>
        </div>

        {error ? <p className="warning landing-min-warning">{error}</p> : null}
      </section>

      {roomNotFound ? (
        <div className="landing-min-bottom-note" role="status" aria-live="polite">
          <img src="/Room_not_found.png" alt="Room not found" className="landing-min-bottom-image" />
          Room not found
        </div>
      ) : null}
    </main>
  );
}

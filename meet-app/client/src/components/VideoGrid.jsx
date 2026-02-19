import { useEffect, useMemo, useRef, useState } from 'react';

function VideoTile({ title, subtitle, stream, muted, isSpeaker, onContextMenu }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return undefined;
    }
    element.srcObject = stream || null;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <article className={`video-tile${isSpeaker ? ' speaker-tile' : ''}`} onContextMenu={onContextMenu}>
      <h3>{title}</h3>
      {subtitle ? <p className="tile-subtitle">{subtitle}</p> : null}
      {isSpeaker ? <span className="speaker-badge">Speaker</span> : null}
      <video ref={videoRef} autoPlay playsInline muted={muted} />
    </article>
  );
}

export function VideoGrid({
  localStream,
  remoteStreams,
  participants,
  localPeerId,
  localUserId,
  speakerId,
  isHost,
  onMakeSpeaker
}) {
  const remoteEntries = Object.entries(remoteStreams);
  const [menuState, setMenuState] = useState(null);

  const participantByPeerId = useMemo(() => participants || {}, [participants]);

  useEffect(() => {
    const closeMenu = () => setMenuState(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  function handleContextMenu(event, participant) {
    if (!isHost || !participant?.userId) {
      return;
    }
    event.preventDefault();
    setMenuState({
      x: event.clientX,
      y: event.clientY,
      participant
    });
  }

  function handleMakeSpeaker() {
    if (!menuState?.participant?.userId) {
      return;
    }
    onMakeSpeaker?.(menuState.participant.userId);
    setMenuState(null);
  }

  const localParticipant = localPeerId ? participantByPeerId[localPeerId] : null;
  const localTitle = localParticipant?.username || 'You';
  const localSubtitle = localParticipant?.isHost ? 'Host' : 'Participant';
  const localSpeaker = Boolean(localUserId && speakerId && localUserId === speakerId);

  return (
    <section className="panel">
      <h2>Meeting Streams</h2>
      <div className="video-grid">
        <VideoTile
          title={localTitle}
          subtitle={localSubtitle}
          stream={localStream}
          muted
          isSpeaker={localSpeaker}
          onContextMenu={(event) => handleContextMenu(event, localParticipant)}
        />
        {remoteEntries.map(([peerId, stream]) => {
          const participant = participantByPeerId[peerId];
          const title = participant?.username || `Peer ${peerId.slice(0, 6)}`;
          const subtitle = participant?.isHost ? 'Host' : 'Participant';
          const remoteIsSpeaker = Boolean(participant?.userId && speakerId && participant.userId === speakerId);

          return (
            <VideoTile
              key={peerId}
              title={title}
              subtitle={subtitle}
              stream={stream}
              isSpeaker={remoteIsSpeaker}
              onContextMenu={(event) => handleContextMenu(event, participant)}
            />
          );
        })}
      </div>

      {menuState ? (
        <div className="speaker-menu" style={{ left: menuState.x, top: menuState.y }}>
          <button
            type="button"
            onClick={handleMakeSpeaker}
            disabled={menuState.participant?.userId === speakerId}
          >
            Make Speaker
          </button>
        </div>
      ) : null}
    </section>
  );
}

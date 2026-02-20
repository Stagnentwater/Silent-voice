import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSpeechToPose } from '../hooks/useSpeechToPose.js';
import { useSignToSpeech } from '../hooks/useSignToSpeech.js';
import { createPoseClient } from '../services/poseApi.js';
import { createPosePacket } from '../services/poseChannel.js';
import { AvatarCanvas } from '../components/AvatarCanvas.jsx';
import { POSE_SERVER_URL, SIGNALING_URL } from '../config/network.js';

// StreamView — when showSpeakingBorder=true, analyses audio and writes
// --spk-rms (0–1) onto the wrapper div so CSS can grow the white border.
function StreamView({ stream, muted, showSpeakingBorder = false }) {
  const videoRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const smoothRef = useRef(0);
  const wrapRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    el.muted = muted;
    el.srcObject = stream || null;

    const attemptPlay = () => {
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Browser may block autoplay until a user gesture; ignore and retry on next render/update.
        });
      }
    };

    const handleLoadedMetadata = () => {
      attemptPlay();
    };

    el.addEventListener('loadedmetadata', handleLoadedMetadata);
    if (stream) {
      attemptPlay();
    }
    return () => {
      el.removeEventListener('loadedmetadata', handleLoadedMetadata);
      el.srcObject = null;
    };
  }, [muted, stream]);

  useEffect(() => {
    if (!showSpeakingBorder || !stream || muted) {
      if (wrapRef.current) wrapRef.current.style.setProperty('--spk-rms', '0');
      return undefined;
    }
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    smoothRef.current = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      analyser.getByteTimeDomainData(samples);
      let total = 0;
      for (let i = 0; i < samples.length; i++) {
        const n = (samples[i] - 128) / 128;
        total += n * n;
      }
      const raw = Math.sqrt(total / samples.length);
      const alpha = raw > smoothRef.current ? 0.3 : 0.07;
      smoothRef.current += alpha * (raw - smoothRef.current);
      if (wrapRef.current) {
        const val = Math.min(Math.pow(smoothRef.current * 6, 0.5), 1);
        wrapRef.current.style.setProperty('--spk-rms', val.toFixed(4));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    ctx.resume().then(() => { rafRef.current = requestAnimationFrame(tick); });
    return () => {
      cancelled = true;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      src.disconnect(); analyser.disconnect(); ctx.close();
      audioCtxRef.current = null;
      if (wrapRef.current) wrapRef.current.style.setProperty('--spk-rms', '0');
    };
  }, [showSpeakingBorder, stream, muted]);

  if (!stream) return <div className="room-live-placeholder">Connecting…</div>;

  return (
    <div ref={wrapRef} className={`stream-wrap${showSpeakingBorder ? ' stream-wrap--monitored' : ''}`}>
      <video ref={videoRef} autoPlay playsInline muted={muted} />
    </div>
  );
}

export function RoomPage() {
  const navigate = useNavigate();
  const { roomCode } = useParams();
  const { user, joinRoom: joinRoomApi } = useAuth();
  const normalizedRoomCode = useMemo(
    () => String(roomCode || '').trim().toUpperCase(),
    [roomCode]
  );

  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [previewStream, setPreviewStream] = useState(null);
  const [mediaError, setMediaError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isAudible, setIsAudible] = useState(false);
  const [latestPosePacket, setLatestPosePacket] = useState(null);
  const [latestInterim, setLatestInterim] = useState('');
  const [speechError, setSpeechError] = useState('');
  const [speakerMenuFor, setSpeakerMenuFor] = useState('');

  const previewVideoRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioFrameRef = useRef(null);
  const waveShellRef = useRef(null);
  const smoothedRmsRef = useRef(0);

  const poseClient = useMemo(() => createPoseClient(POSE_SERVER_URL), []);

  const {
    localStream,
    remoteStreams,
    participants,
    peerId: localPeerId,
    joinedRoom,
    hostId,
    speakerId,
    isHost,
    connectionState,
    joinRoom: joinRealtimeRoom,
    leaveRoom,
    setSpeaker,
    sendPosePacket
  } = useWebRTC({
    signalingUrl: SIGNALING_URL,
    onPosePacket: (packet) => {
      if (packet?.type === 'sign-speech') return;
      setLatestPosePacket(packet);
    }
  });

  const normalizeId = (value) => String(value ?? '').trim();
  const currentUserId = normalizeId(user?.id);
  const currentSpeakerId = normalizeId(speakerId);
  const currentHostId = normalizeId(hostId);

  const effectiveSpeakerId = currentSpeakerId || currentUserId || null;
  const isCurrentSpeaker = Boolean(currentUserId && effectiveSpeakerId && currentUserId === effectiveSpeakerId);
  const signToSpeech = useSignToSpeech({
    localStream,
    active: isCurrentSpeaker,
    onWord: (word) => sendPosePacket({ type: 'sign-speech', word, speakerId: currentUserId }),
  });

  const speech = useSpeechToPose({
    poseClient,
    speakerId: user?.id,
    onPoseReady: ({ text, poseIds, poseFrames, timings, speakerId: packetSpeakerId }) => {
      const packet = createPosePacket({ text, poseIds, poseFrames, timings, speakerId: packetSpeakerId });
      setLatestPosePacket(packet);
      sendPosePacket(packet);
    }
  });

  async function handleJoinMeeting() {
    setError('');
    if (!/^[A-Z0-9]{6}$/.test(normalizedRoomCode)) { setError('Invalid room code.'); return; }
    setConnecting(true);
    try {
      const roomMeta = await joinRoomApi({ roomCode: normalizedRoomCode });
      const resolvedUserId = String(user?.id || '').trim();
      if (!resolvedUserId) throw new Error('Unable to identify current user');
      await joinRealtimeRoom(normalizedRoomCode, {
        userId: resolvedUserId,
        username: user?.username,
        hostId: String(roomMeta?.hostId || '').trim() || resolvedUserId,
        audioEnabled: !isMuted,
        videoEnabled: !isVideoOff
      });
      if (previewStream) { previewStream.getTracks().forEach((t) => t.stop()); setPreviewStream(null); }
    } catch (err) {
      setError(err.message || 'Unable to join meeting');
    } finally {
      setConnecting(false);
    }
  }

  function handleLeaveMeeting() {
    speech.stop();
    signToSpeech.stop();
    leaveRoom();
    navigate(`/room/${normalizedRoomCode}`, { replace: true });
  }

  const hasJoined = Boolean(joinedRoom);

  useEffect(() => {
    const onError = (event) => {
      console.error('[GlobalError]', event?.message, event?.filename, event?.lineno, event?.error);
    };

    const onUnhandledRejection = (event) => {
      console.error('[UnhandledRejection]', event?.reason);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (hasJoined) return undefined;
    let active = true;
    async function loadPreview() {
      setMediaError('');

      const hasGetUserMedia =
        typeof navigator !== 'undefined' &&
        Boolean(navigator.mediaDevices?.getUserMedia);

      if (!hasGetUserMedia) {
        const overHttpOnLan =
          typeof window !== 'undefined' &&
          window.location.protocol === 'http:' &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1';

        if (overHttpOnLan) {
          setMediaError('Camera is blocked on HTTP LAN URLs. Open the app over HTTPS (or localhost) and try again.');
          return;
        }

        setMediaError('Camera API is unavailable in this browser context.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
        stream.getAudioTracks().forEach((t) => { t.enabled = !isMuted; });
        stream.getVideoTracks().forEach((t) => { t.enabled = !isVideoOff; });
        setPreviewStream(stream);
      } catch (error) {
        if (error?.name === 'NotAllowedError') {
          setMediaError('Camera permission was denied. Allow camera access and try again.');
          return;
        }

        if (error?.name === 'NotFoundError') {
          setMediaError('No camera device was found.');
          return;
        }

        if (error?.name === 'NotReadableError') {
          setMediaError('Camera is already in use by another app.');
          return;
        }

        if (error?.name === 'SecurityError') {
          setMediaError('Camera requires HTTPS (or localhost).');
          return;
        }

        setMediaError('Camera access is required to preview before joining.');
      }
    }
    loadPreview();
    return () => { active = false; };
  }, [hasJoined]);

  useEffect(() => {
    if (!previewVideoRef.current || !previewStream) return;
    previewVideoRef.current.srcObject = previewStream;
  }, [previewStream]);

  useEffect(() => {
    if (!previewStream || isMuted || hasJoined) {
      setIsAudible(false);
      if (waveShellRef.current) waveShellRef.current.style.setProperty('--rms', '0');
      return undefined;
    }
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    const source = audioContext.createMediaStreamSource(previewStream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    smoothedRmsRef.current = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      analyser.getByteTimeDomainData(samples);
      let total = 0;
      for (let i = 0; i < samples.length; i++) {
        const n = (samples[i] - 128) / 128;
        total += n * n;
      }
      const rawRms = Math.sqrt(total / samples.length);
      const alpha = rawRms > smoothedRmsRef.current ? 0.25 : 0.06;
      smoothedRmsRef.current += alpha * (rawRms - smoothedRmsRef.current);
      const rms = smoothedRmsRef.current;
      setIsAudible(rms > 0.025);
      if (waveShellRef.current) {
        const curved = Math.pow(Math.min(rms * 5, 1), 0.55);
        waveShellRef.current.style.setProperty('--rms', curved.toFixed(4));
      }
      audioFrameRef.current = requestAnimationFrame(tick);
    };
    audioContext.resume().then(() => { audioFrameRef.current = requestAnimationFrame(tick); });
    return () => {
      cancelled = true;
      if (audioFrameRef.current) { cancelAnimationFrame(audioFrameRef.current); audioFrameRef.current = null; }
      source.disconnect(); analyser.disconnect(); audioContext.close();
      audioContextRef.current = null;
      setIsAudible(false);
      if (waveShellRef.current) waveShellRef.current.style.setProperty('--rms', '0');
    };
  }, [hasJoined, isMuted, previewStream]);

  useEffect(() => () => {
    if (audioFrameRef.current) { cancelAnimationFrame(audioFrameRef.current); audioFrameRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (previewStream) previewStream.getTracks().forEach((t) => t.stop());
  }, [previewStream]);

  function handleToggleMute() {
    setIsMuted((current) => {
      const nextMuted = !current;
      const activeStream = hasJoined ? localStream : previewStream;
      if (activeStream) activeStream.getAudioTracks().forEach((t) => { t.enabled = !nextMuted; });
      if (nextMuted && speech.listening) { speech.stop(); setLatestInterim(''); }
      if (nextMuted && signToSpeech.listening) signToSpeech.stop();
      return nextMuted;
    });
  }

  function handleToggleVideo() {
    setIsVideoOff((current) => {
      const nextVideoOff = !current;
      const activeStream = hasJoined ? localStream : previewStream;
      if (activeStream) activeStream.getVideoTracks().forEach((t) => { t.enabled = !nextVideoOff; });
      return nextVideoOff;
    });
  }

  function handleBackToLanding() {
    if (previewStream) { previewStream.getTracks().forEach((t) => t.stop()); setPreviewStream(null); }
    navigate('/landing', { replace: true });
  }

  function handleStartSpeech() {
    if (isMuted) { setSpeechError('Unmute to start speech-to-sign.'); return; }
    if (!isCurrentSpeaker) { setSpeechError('Only the current speaker can start speech-to-sign.'); return; }
    if (signToSpeech.listening) signToSpeech.stop();
    setSpeechError('');
    speech.start();
  }

  function handleStopSpeech() { speech.stop(); setLatestInterim(''); }

  function handleStartSignToSpeech() {
    if (isMuted) { setSpeechError('Unmute to use Speak with Sign.'); return; }
    if (!isCurrentSpeaker) { setSpeechError('Only the current speaker can use Speak with Sign.'); return; }
    if (speech.listening) { speech.stop(); setLatestInterim(''); }
    setSpeechError('');
    signToSpeech.start();
  }

  function handleStopSignToSpeech() { signToSpeech.stop(); }

  useEffect(() => { setLatestInterim(speech.interimText || ''); }, [speech.interimText]);
  useEffect(() => { if (speech.lastError) setSpeechError(speech.lastError); }, [speech.lastError]);
  useEffect(() => { if (!isCurrentSpeaker && speech.listening) { speech.stop(); setLatestInterim(''); } }, [isCurrentSpeaker, speech]);
  useEffect(() => { if (isMuted && speech.listening) { speech.stop(); setLatestInterim(''); } }, [isMuted, speech]);
  useEffect(() => { if (signToSpeech.error) setSpeechError(signToSpeech.error); }, [signToSpeech.error]);
  useEffect(() => { if (!isCurrentSpeaker && signToSpeech.listening) signToSpeech.stop(); }, [isCurrentSpeaker, signToSpeech]);

  // ─── PRE-JOIN ─────────────────────────────────────────────────────────────────
  if (!hasJoined) {
    return (
      <main className="room-prejoin-shell">
        <div className="room-prejoin-strips" aria-hidden="true" />
        <button type="button" className="room-prejoin-back" onClick={handleBackToLanding}>← Back</button>
        <section className="room-prejoin-stage">
          <div ref={waveShellRef} className={`room-prejoin-preview-shell ${isAudible && !isMuted ? 'is-audible' : ''}`}>
            <span className="room-prejoin-wave" aria-hidden="true" />
            <div className="room-prejoin-preview">
              {previewStream
                ? <video ref={previewVideoRef} autoPlay muted playsInline />
                : <div className="room-prejoin-placeholder">Waiting for camera preview…</div>}
            </div>
          </div>
          <p className={`room-audio-indicator ${isMuted ? 'is-muted' : isAudible ? 'is-audible' : ''}`}>
            {isMuted ? 'Muted' : isAudible ? 'Audible' : 'Not audible'}
          </p>
          <div className="room-prejoin-controls">
            <button type="button" onClick={handleToggleMute}>{isMuted ? 'Unmute' : 'Mute'}</button>
            <button type="button" onClick={handleToggleVideo}>{isVideoOff ? 'Open video' : 'Close video'}</button>
            <button type="button" className="room-prejoin-join" onClick={handleJoinMeeting} disabled={connecting}>
              {connecting ? 'Joining…' : 'Join'}
            </button>
          </div>
          {error ? <p className="warning room-prejoin-warning">{error}</p> : null}
          {mediaError ? <p className="warning room-prejoin-warning">{mediaError}</p> : null}
        </section>
      </main>
    );
  }

  // ─── LIVE MEETING ─────────────────────────────────────────────────────────────
  const participantsByPeerId = participants || {};
  const isLocalUserHost = Boolean(currentUserId && currentHostId && currentUserId === currentHostId);
  const canAssignSpeaker = Boolean(isHost || isLocalUserHost);

  const hostLabel = isLocalUserHost
    ? user?.username || 'You'
    : Object.values(participantsByPeerId).find((p) => normalizeId(p?.userId) === currentHostId)?.username || (currentHostId ? 'Host' : 'pending');

  const speakerLabel = !currentSpeakerId
    ? 'none'
    : currentUserId === currentSpeakerId
      ? user?.username || 'You'
      : Object.values(participantsByPeerId).find((p) => normalizeId(p?.userId) === currentSpeakerId)?.username || 'assigned';

  const speakerPeerId = Object.entries(participantsByPeerId).find(([pid, p]) => {
    return pid !== localPeerId && normalizeId(p?.userId) === effectiveSpeakerId;
  })?.[0] || null;

  const featuredSpeakerStream = !effectiveSpeakerId
    ? localStream
    : effectiveSpeakerId === currentUserId
      ? localStream
      : (speakerPeerId ? remoteStreams[speakerPeerId] : null);

  const featuredSpeakerName = effectiveSpeakerId
    ? effectiveSpeakerId === currentUserId ? user?.username || 'You' : speakerLabel
    : user?.username || 'You';

  const participantTiles = [
    {
      key: `self-${currentUserId || 'me'}`,
      userId: currentUserId,
      name: user?.username || 'You',
      isYou: true,
      isHostTile: isLocalUserHost,
      stream: localStream,
      isSpeaker: Boolean(currentUserId && effectiveSpeakerId && currentUserId === effectiveSpeakerId)
    },
    ...Object.entries(participantsByPeerId)
      .filter(([pid]) => pid !== localPeerId)
      .map(([remotePeerId, participant]) => {
        const participantUserId = normalizeId(participant?.userId);
        return {
          key: `peer-${remotePeerId}`,
          userId: participantUserId,
          name: participant?.username || `Peer ${remotePeerId.slice(0, 6)}`,
          isYou: false,
          isHostTile: Boolean(participant?.isHost || (participantUserId && participantUserId === currentHostId)),
          stream: remoteStreams[remotePeerId] || null,
          isSpeaker: Boolean(participantUserId && effectiveSpeakerId && participantUserId === effectiveSpeakerId)
        };
      })
  ];

  function toggleSpeakerMenu(tileKey) {
    setSpeakerMenuFor((current) => (current === tileKey ? '' : tileKey));
  }

  function handleKeepSpeaker(nextSpeakerId) {
    if (!canAssignSpeaker || !nextSpeakerId) return;
    setSpeaker(nextSpeakerId);
    setSpeakerMenuFor('');
  }

  return (
    <main className="room-live-shell">

      {/* ── Top bar ── */}
      <header className="room-live-topbar">
        <div className="room-live-topbar-left">
          <span className="room-live-brand">◈ Session</span>
          <span className="room-live-roomcode">{joinedRoom}</span>
        </div>
        <div className="room-live-topbar-right">
          <span className={`room-live-dot ${connectionState === 'connected' ? 'room-live-dot--live' : ''}`} />
          <span className="room-live-conn">{connectionState || 'connecting'}</span>
        </div>
      </header>

      {/* ── Stage ── */}
      <section className="room-live-stage">

        {/* Featured row: speaker + avatar */}
        <div className="room-live-featured">

          <article className="room-live-feature-tile room-live-feature-speaker">
            <div className="room-live-media-wrap">
              <button type="button" className="room-live-more" onClick={() => toggleSpeakerMenu('featured-speaker')} disabled={!canAssignSpeaker} aria-label="Speaker options">⋮</button>
              {speakerMenuFor === 'featured-speaker' && canAssignSpeaker ? (
                <div className="room-live-menu">
                  <button type="button" onClick={() => handleKeepSpeaker(effectiveSpeakerId)} disabled={!effectiveSpeakerId || speakerId === effectiveSpeakerId}>Keep as speaker</button>
                </div>
              ) : null}
              <StreamView stream={featuredSpeakerStream} muted={featuredSpeakerStream === localStream} showSpeakingBorder />
            </div>
            <div className="room-live-tile-footer">
              <span className="room-live-tile-name">{featuredSpeakerName}</span>
              <span className="room-live-badge room-live-badge--spk">● Speaking</span>
            </div>
          </article>

          <article className="room-live-feature-tile room-live-avatar-tile">
            <div className="room-live-media-wrap room-live-avatar-media">
              <AvatarCanvas
                latestPosePacket={latestPosePacket}
                displayText={latestInterim || latestPosePacket?.text || ''}
                compact
              />
            </div>
            <div className="room-live-tile-footer">
              <span className="room-live-tile-name">Sign Avatar</span>
            </div>
          </article>
        </div>

        {/* Participant strip */}
        {participantTiles.length ? (
          <div className="room-live-grid">
            {participantTiles.map((tile) => (
              <article key={tile.key} className="room-live-tile">
                <div className="room-live-media-wrap">
                  <button type="button" className="room-live-more" onClick={() => toggleSpeakerMenu(tile.key)} disabled={!canAssignSpeaker} aria-label="Speaker options">⋮</button>
                  {speakerMenuFor === tile.key && canAssignSpeaker ? (
                    <div className="room-live-menu">
                      <button type="button" onClick={() => handleKeepSpeaker(tile.userId)} disabled={!tile.userId || speakerId === tile.userId}>Make speaker</button>
                    </div>
                  ) : null}
                  {/* Remote tiles get audio monitored; local tile is muted so no feedback loop */}
                  <StreamView stream={tile.stream} muted={tile.isYou} showSpeakingBorder={!tile.isYou} />
                </div>
                <div className="room-live-tile-footer">
                  <span className="room-live-tile-name">{tile.name}</span>
                  {tile.isHostTile && <span className="room-live-badge room-live-badge--host">Host</span>}
                  {tile.isYou && <span className="room-live-badge room-live-badge--you">You</span>}
                </div>
              </article>
            ))}
          </div>
        ) : null}

      </section>

      {/* ── Dock ── */}
      <footer className="room-live-dock">
        <div className="room-live-dock-inner">
          <button type="button" className={`dock-btn${isMuted ? ' dock-btn--warn' : ''}`} onClick={handleToggleMute}>
            <span className="dock-icon">{isMuted ? '🔇' : '🎙'}</span>
            <span>{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button type="button" className={`dock-btn${isVideoOff ? ' dock-btn--warn' : ''}`} onClick={handleToggleVideo}>
            <span className="dock-icon">{isVideoOff ? '📷' : '📷'}</span>
            <span>{isVideoOff ? 'Start Video' : 'Stop Video'}</span>
          </button>
          {speech.listening ? (
            <button type="button" className="dock-btn dock-btn--sign" onClick={handleStopSpeech} disabled={!isCurrentSpeaker}>
              <span className="dock-icon">🤟</span><span>Stop Sign</span>
            </button>
          ) : (
            <button type="button" className="dock-btn" onClick={handleStartSpeech} disabled={!isCurrentSpeaker || isMuted}>
              <span className="dock-icon">🤟</span><span>Start Sign</span>
            </button>
          )}
          {isCurrentSpeaker && (
            signToSpeech.listening ? (
              <button type="button" className="dock-btn dock-btn--sign" onClick={handleStopSignToSpeech}>
                <span className="dock-icon">🔊</span><span>Stop Speak</span>
              </button>
            ) : (
              <button type="button" className="dock-btn" onClick={handleStartSignToSpeech} disabled={isMuted}>
                <span className="dock-icon">🔊</span><span>Speak with Sign</span>
              </button>
            )
          )}
          <button type="button" className="dock-btn dock-btn--leave" onClick={handleLeaveMeeting}>
            <span className="dock-icon">↩</span><span>Leave</span>
          </button>
        </div>

        {latestInterim ? <p className="room-live-interim">"{latestInterim}"</p> : null}
        {signToSpeech.listening && (
          <p className="room-live-interim">
            {signToSpeech.currentLetter ? `Signing: ${signToSpeech.currentLetter}` : 'Watching hands…'}
            {signToSpeech.currentWord ? ` · Word so far: ${signToSpeech.currentWord}` : ''}
          </p>
        )}
        {speechError ? <p className="room-live-warning">{speechError}</p> : null}
        {error ? <p className="room-live-warning">{error}</p> : null}

        <p className="room-live-footer-meta">
          Host: <strong>{hostLabel}</strong>&ensp;·&ensp;Speaker: <strong>{speakerLabel}</strong>
        </p>
      </footer>

    </main>
  );
}
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSpeechToPose } from '../hooks/useSpeechToPose.js';
import { createPoseClient } from '../services/poseApi.js';
import { createPosePacket } from '../services/poseChannel.js';
import { AvatarCanvas } from '../components/AvatarCanvas.jsx';

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:8080';
const POSE_SERVER_URL = import.meta.env.VITE_POSE_SERVER_URL || 'http://localhost:5000';

function StreamView({ stream, muted }) {
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

  if (!stream) {
    return <div className="room-live-placeholder">No video stream</div>;
  }

  return <video ref={videoRef} autoPlay playsInline muted={muted} />;
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
  const poseClient = useMemo(() => createPoseClient(POSE_SERVER_URL), []);

  const {
    localStream,
    remoteStreams,
    participants,
    peerId,
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
      setLatestPosePacket(packet);
    }
  });

  const isCurrentSpeaker = Boolean(user?.id && speakerId && user.id === speakerId);

  const speech = useSpeechToPose({
    poseClient,
    speakerId: user?.id,
    onPoseReady: ({ text, poseIds, poseFrames, timings, speakerId: packetSpeakerId }) => {
      const packet = createPosePacket({
        text,
        poseIds,
        poseFrames,
        timings,
        speakerId: packetSpeakerId
      });

      setLatestPosePacket(packet);
      sendPosePacket(packet);
    }
  });

  async function handleJoinMeeting() {
    setError('');

    if (!/^[A-Z0-9]{6}$/.test(normalizedRoomCode)) {
      setError('Invalid room code.');
      return;
    }

    setConnecting(true);
    try {
      const roomMeta = await joinRoomApi({ roomCode: normalizedRoomCode });
      const resolvedUserId = String(user?.id || '').trim();
      if (!resolvedUserId) {
        throw new Error('Unable to identify current user');
      }

      await joinRealtimeRoom(normalizedRoomCode, {
        userId: resolvedUserId,
        username: user?.username,
        hostId: String(roomMeta?.hostId || '').trim() || resolvedUserId,
        audioEnabled: !isMuted,
        videoEnabled: !isVideoOff
      });

      if (previewStream) {
        previewStream.getTracks().forEach((track) => track.stop());
        setPreviewStream(null);
      }
    } catch (err) {
      setError(err.message || 'Unable to join meeting');
    } finally {
      setConnecting(false);
    }
  }

  function handleLeaveMeeting() {
    speech.stop();
    leaveRoom();
    navigate(`/room/${normalizedRoomCode}`, { replace: true });
  }

  const hasJoined = Boolean(joinedRoom);

  useEffect(() => {
    if (hasJoined) {
      return undefined;
    }

    let active = true;

    async function loadPreview() {
      setMediaError('');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream.getAudioTracks().forEach((track) => {
          track.enabled = !isMuted;
        });
        stream.getVideoTracks().forEach((track) => {
          track.enabled = !isVideoOff;
        });

        setPreviewStream(stream);
      } catch {
        setMediaError('Camera access is required to preview before joining.');
      }
    }

    loadPreview();

    return () => {
      active = false;
    };
  }, [hasJoined]);

  useEffect(() => {
    if (!previewVideoRef.current || !previewStream) {
      return;
    }

    previewVideoRef.current.srcObject = previewStream;
  }, [previewStream]);

  useEffect(() => {
    if (!previewStream || isMuted || hasJoined) {
      setIsAudible(false);
      return undefined;
    }

    let cancelled = false;
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.75;

    const source = audioContext.createMediaStreamSource(previewStream);
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);

    const detectSound = () => {
      if (cancelled) {
        return;
      }

      analyser.getByteTimeDomainData(samples);
      let total = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const normalized = (samples[index] - 128) / 128;
        total += normalized * normalized;
      }

      const rms = Math.sqrt(total / samples.length);
      setIsAudible(rms > 0.03);
      audioFrameRef.current = requestAnimationFrame(detectSound);
    };

    audioContext.resume().finally(() => {
      audioFrameRef.current = requestAnimationFrame(detectSound);
    });

    return () => {
      cancelled = true;
      if (audioFrameRef.current) {
        cancelAnimationFrame(audioFrameRef.current);
        audioFrameRef.current = null;
      }
      source.disconnect();
      analyser.disconnect();
      audioContext.close();
      audioContextRef.current = null;
      setIsAudible(false);
    };
  }, [hasJoined, isMuted, previewStream]);

  useEffect(() => () => {
    if (audioFrameRef.current) {
      cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (previewStream) {
      previewStream.getTracks().forEach((track) => track.stop());
    }
  }, [previewStream]);

  function handleToggleMute() {
    setIsMuted((current) => {
      const nextMuted = !current;
      const activeStream = hasJoined ? localStream : previewStream;
      if (activeStream) {
        activeStream.getAudioTracks().forEach((track) => {
          track.enabled = !nextMuted;
        });
      }
      if (nextMuted && speech.listening) {
        speech.stop();
        setLatestInterim('');
      }
      return nextMuted;
    });
  }

  function handleToggleVideo() {
    setIsVideoOff((current) => {
      const nextVideoOff = !current;
      const activeStream = hasJoined ? localStream : previewStream;
      if (activeStream) {
        activeStream.getVideoTracks().forEach((track) => {
          track.enabled = !nextVideoOff;
        });
      }
      return nextVideoOff;
    });
  }

  function handleBackToLanding() {
    if (previewStream) {
      previewStream.getTracks().forEach((track) => track.stop());
      setPreviewStream(null);
    }
    navigate('/landing', { replace: true });
  }

  function handleStartSpeech() {
    if (isMuted) {
      setSpeechError('Unmute to start speech-to-sign.');
      return;
    }

    if (!isCurrentSpeaker) {
      setSpeechError('Only the current speaker can start speech-to-sign.');
      return;
    }
    setSpeechError('');
    speech.start();
  }

  function handleStopSpeech() {
    speech.stop();
    setLatestInterim('');
  }

  useEffect(() => {
    setLatestInterim(speech.interimText || '');
  }, [speech.interimText]);

  useEffect(() => {
    if (speech.lastError) {
      setSpeechError(speech.lastError);
    }
  }, [speech.lastError]);

  useEffect(() => {
    if (!isCurrentSpeaker && speech.listening) {
      speech.stop();
      setLatestInterim('');
    }
  }, [isCurrentSpeaker, speech]);

  useEffect(() => {
    if (isMuted && speech.listening) {
      speech.stop();
      setLatestInterim('');
    }
  }, [isMuted, speech]);

  if (!hasJoined) {
    return (
      <main className="room-prejoin-shell">
        <div className="room-prejoin-strips" aria-hidden="true" />

        <button type="button" className="room-prejoin-back" onClick={handleBackToLanding}>
          ← Back
        </button>

        <section className="room-prejoin-stage">
          <div className={`room-prejoin-preview-shell ${isAudible && !isMuted ? 'is-audible' : ''}`}>
            <span className="room-prejoin-wave room-prejoin-wave-1" aria-hidden="true" />
            <span className="room-prejoin-wave room-prejoin-wave-2" aria-hidden="true" />
            <span className="room-prejoin-wave room-prejoin-wave-3" aria-hidden="true" />

            <div className="room-prejoin-preview">
              {previewStream ? (
                <video ref={previewVideoRef} autoPlay muted playsInline />
              ) : (
                <div className="room-prejoin-placeholder">Waiting for camera preview…</div>
              )}
            </div>
          </div>

          <p className={`room-audio-indicator ${isMuted ? 'is-muted' : isAudible ? 'is-audible' : ''}`}>
            {isMuted ? 'Muted' : isAudible ? 'Audible' : 'Not audible'}
          </p>

          <div className="room-prejoin-controls">
            <button type="button" onClick={handleToggleMute}>
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" onClick={handleToggleVideo}>
              {isVideoOff ? 'Open video' : 'Close video'}
            </button>
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

  const remoteEntries = Object.entries(remoteStreams);
  const participantsByPeerId = participants || {};
  const isLocalUserHost = Boolean(user?.id && hostId && user.id === hostId);
  const canAssignSpeaker = Boolean(isHost || isLocalUserHost);

  const hostLabel = isLocalUserHost
    ? user?.username || 'You'
    : Object.values(participantsByPeerId).find((participant) => participant?.userId === hostId)
        ?.username || (hostId ? 'Host' : 'pending');

  const speakerLabel = !speakerId
    ? 'none'
    : user?.id === speakerId
      ? user?.username || 'You'
      : Object.values(participantsByPeerId).find((participant) => participant?.userId === speakerId)
          ?.username || 'assigned';

  const effectiveSpeakerId = speakerId || user?.id || null;

  const speakerPeerId = remoteEntries.find(([peerId]) => {
    const participant = participantsByPeerId[peerId];
    return participant?.userId && effectiveSpeakerId && participant.userId === effectiveSpeakerId;
  })?.[0] || null;

  const featuredSpeakerStream = effectiveSpeakerId
    ? effectiveSpeakerId === user?.id
      ? localStream
      : speakerPeerId
        ? remoteStreams[speakerPeerId]
        : localStream
    : localStream;

  const featuredSpeakerName = effectiveSpeakerId
    ? effectiveSpeakerId === user?.id
      ? `${user?.username || 'You'} (Speaker)`
      : `${speakerLabel} (Speaker)`
    : `${user?.username || 'You'} (Speaker)`;

  const nonSpeakerTiles = [
    {
      key: `self-${user?.id || 'me'}`,
      userId: user?.id,
      name: `${user?.username || 'You'}${isLocalUserHost ? ' (Host)' : ''}`,
      stream: localStream,
      isSpeaker: Boolean(user?.id && effectiveSpeakerId === user.id)
    },
    ...remoteEntries.map(([remotePeerId, stream]) => {
      const participant = participantsByPeerId[remotePeerId];
      return {
        key: `peer-${remotePeerId}`,
        userId: participant?.userId,
        name: `${participant?.username || `Peer ${remotePeerId.slice(0, 6)}`}${participant?.isHost ? ' (Host)' : ''}`,
        stream,
        isSpeaker: Boolean(
          participant?.userId && effectiveSpeakerId && participant.userId === effectiveSpeakerId
        )
      };
    })
  ].filter((tile) => !tile.isSpeaker);

  function toggleSpeakerMenu(tileKey) {
    setSpeakerMenuFor((current) => (current === tileKey ? '' : tileKey));
  }

  function handleKeepSpeaker(nextSpeakerId) {
    if (!canAssignSpeaker || !nextSpeakerId) {
      return;
    }
    setSpeaker(nextSpeakerId);
    setSpeakerMenuFor('');
  }

  return (
    <main className="room-live-shell">
      <section className="room-live-stage">
        <div className="room-live-meta">{joinedRoom}</div>

        <div className="room-live-featured">
          <article className="room-live-feature-tile room-live-feature-speaker">
            <div className="room-live-media-wrap">
              <button
                type="button"
                className="room-live-more"
                onClick={() => toggleSpeakerMenu('featured-speaker')}
                disabled={!canAssignSpeaker}
                aria-label="Speaker options"
              >
                ⋮
              </button>

              {speakerMenuFor === 'featured-speaker' && canAssignSpeaker ? (
                <div className="room-live-menu">
                  <button
                    type="button"
                    onClick={() => handleKeepSpeaker(effectiveSpeakerId)}
                    disabled={!effectiveSpeakerId || speakerId === effectiveSpeakerId}
                  >
                    Keep as speaker
                  </button>
                </div>
              ) : null}

              <StreamView
                stream={featuredSpeakerStream}
                muted={effectiveSpeakerId === user?.id || !effectiveSpeakerId}
              />
            </div>
            <p>{featuredSpeakerName}</p>
          </article>

          <article className="room-live-feature-tile room-live-avatar-tile">
            <div className="room-live-media-wrap room-live-avatar-media">
              <AvatarCanvas latestPosePacket={latestPosePacket} compact />
            </div>
            <p>Sign Avatar</p>
          </article>
        </div>

        {nonSpeakerTiles.length ? (
          <div className="room-live-grid">
            {nonSpeakerTiles.map((tile) => (
              <article key={tile.key} className="room-live-tile">
                <div className="room-live-media-wrap">
                  <button
                    type="button"
                    className="room-live-more"
                    onClick={() => toggleSpeakerMenu(tile.key)}
                    disabled={!canAssignSpeaker}
                    aria-label="Speaker options"
                  >
                    ⋮
                  </button>

                  {speakerMenuFor === tile.key && canAssignSpeaker ? (
                    <div className="room-live-menu">
                      <button
                        type="button"
                        onClick={() => handleKeepSpeaker(tile.userId)}
                        disabled={!tile.userId || speakerId === tile.userId}
                      >
                        Keep as speaker
                      </button>
                    </div>
                  ) : null}

                  <StreamView stream={tile.stream} muted={tile.userId === user?.id} />
                </div>
                <p>{tile.name}</p>
              </article>
            ))}
          </div>
        ) : null}

        <div className="room-live-dock">
          <button type="button" onClick={handleToggleMute}>
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          <button type="button" onClick={handleToggleVideo}>
            {isVideoOff ? 'Video on' : 'Video off'}
          </button>
          {speech.listening ? (
            <button type="button" onClick={handleStopSpeech} disabled={!isCurrentSpeaker}>
              Stop sign
            </button>
          ) : (
            <button type="button" onClick={handleStartSpeech} disabled={!isCurrentSpeaker || isMuted}>
              Start sign
            </button>
          )}
          <button type="button" className="room-live-leave" onClick={handleLeaveMeeting}>
            Leave
          </button>
        </div>

        {latestInterim ? <p className="room-live-interim">{latestInterim}</p> : null}
        {speechError ? <p className="room-live-warning warning">{speechError}</p> : null}
        {error ? <p className="room-live-warning warning">{error}</p> : null}

        <p className="room-live-footer">
          {connectionState || 'connecting'} • Host: {hostLabel} • Speaker: {speakerLabel}
        </p>
      </section>
    </main>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignalingClient } from '../webrtc/signalingClient.js';
import {
  POSE_CHANNEL_NAME,
  decodePosePacket,
  encodePosePacket
} from '../services/poseChannel.js';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function parseIceServers() {
  const fromEnv = import.meta.env.VITE_ICE_SERVERS;
  if (!fromEnv) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(fromEnv);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

export function useWebRTC({ signalingUrl, onPosePacket }) {
  const JOIN_ACK_TIMEOUT_MS = 8000;

  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [participants, setParticipants] = useState({});
  const [peerId, setPeerId] = useState('');
  const [hostId, setHostId] = useState(null);
  const [speakerId, setSpeakerId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [connectionState, setConnectionState] = useState('idle');
  const [joinedRoom, setJoinedRoom] = useState('');

  const signalingClientRef = useRef(null);
  const localStreamRef = useRef(null);
  const currentUserRef = useRef({ userId: null, username: null });
  const hostHintRef = useRef(null);
  const roomIdRef = useRef('');
  const peerIdRef = useRef('');
  const peersRef = useRef(new Map());
  const dataChannelsRef = useRef(new Map());
  const makingOfferRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const failedCleanupTimersRef = useRef(new Map());
  const pendingJoinRef = useRef(null);
  const iceServers = useMemo(parseIceServers, []);

  const onPosePacketRef = useRef(onPosePacket);
  useEffect(() => { onPosePacketRef.current = onPosePacket; }, [onPosePacket]);

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const settlePendingJoin = useCallback((resolver, payloadOrError) => {
    if (!pendingJoinRef.current) return;
    const { timeoutId } = pendingJoinRef.current;
    clearTimeout(timeoutId);
    pendingJoinRef.current = null;
    resolver(payloadOrError);
  }, []);

  const clearFailedCleanupTimer = useCallback((targetPeerId) => {
    const id = failedCleanupTimersRef.current.get(targetPeerId);
    if (id) {
      clearTimeout(id);
      failedCleanupTimersRef.current.delete(targetPeerId);
    }
  }, []);

  const queuePendingCandidate = useCallback((targetPeerId, candidate) => {
    const queue = pendingCandidatesRef.current.get(targetPeerId) || [];
    queue.push(candidate);
    pendingCandidatesRef.current.set(targetPeerId, queue);
  }, []);

  const flushPendingCandidates = useCallback(async (targetPeerId, peerConnection) => {
    const queue = pendingCandidatesRef.current.get(targetPeerId);
    if (!queue || !queue.length) return;
    const retry = [];
    for (const candidate of queue) {
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch {
        retry.push(candidate);
      }
    }
    if (retry.length) {
      pendingCandidatesRef.current.set(targetPeerId, retry);
    } else {
      pendingCandidatesRef.current.delete(targetPeerId);
    }
  }, []);

  const cleanupPeer = useCallback((targetPeerId) => {
    clearFailedCleanupTimer(targetPeerId);

    const connection = peersRef.current.get(targetPeerId);
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.ondatachannel = null;
      connection.onconnectionstatechange = null;
      try { connection.close(); } catch { /* already closed */ }
    }

    const channel = dataChannelsRef.current.get(targetPeerId);
    if (channel) {
      channel.onmessage = null;
      channel.onopen = null;
      channel.onclose = null;
      try { channel.close(); } catch { /* already closed */ }
    }

    peersRef.current.delete(targetPeerId);
    dataChannelsRef.current.delete(targetPeerId);
    makingOfferRef.current.delete(targetPeerId);
    pendingCandidatesRef.current.delete(targetPeerId);

    setRemoteStreams((current) => {
      const next = { ...current };
      delete next[targetPeerId];
      return next;
    });
  }, [clearFailedCleanupTimer]);

  const attachDataChannel = useCallback((targetPeerId, channel) => {
    channel.onmessage = (event) => {
      const decoded = decodePosePacket(event.data);
      if (decoded && onPosePacketRef.current) {
        onPosePacketRef.current(decoded);
      }
    };
    channel.onopen = () => {
      dataChannelsRef.current.set(targetPeerId, channel);
    };
    channel.onclose = () => {
      dataChannelsRef.current.delete(targetPeerId);
    };
  }, []);

  // ─── createPeerConnection ────────────────────────────────────────────────────
  // `initiator` = true means WE send the offer and create the DataChannel.
  // Both sides always add their local tracks so SDP is sendrecv on both ends.

  const createPeerConnection = useCallback((targetPeerId, initiator) => {
    const existing = peersRef.current.get(targetPeerId);
    if (existing) {
      const state = existing.connectionState;
      if (state !== 'closed' && state !== 'failed') return existing;
      // Tear down dead connection before creating a fresh one
      existing.onicecandidate = null;
      existing.ontrack = null;
      existing.ondatachannel = null;
      existing.onconnectionstatechange = null;
      try { existing.close(); } catch { /* already closed */ }
      peersRef.current.delete(targetPeerId);
      dataChannelsRef.current.delete(targetPeerId);
      makingOfferRef.current.delete(targetPeerId);
      pendingCandidatesRef.current.delete(targetPeerId);
    }

    const pc = new RTCPeerConnection({ iceServers });

    // Always add local tracks — both sides must advertise sendrecv so the
    // remote ontrack fires on each end.
    const localTracks = localStreamRef.current?.getTracks?.() ?? [];
    if (localTracks.length > 0) {
      localTracks.forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    } else {
      // No camera/mic yet — still declare recv capability so the far end can send.
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.addTransceiver('video', { direction: 'recvonly' });
      } catch { /* older browsers */ }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate || !signalingClientRef.current) return;
      signalingClientRef.current.send('signal', {
        roomId: roomIdRef.current,
        targetPeerId,
        fromPeerId: peerIdRef.current || undefined,
        signal: { type: 'candidate', candidate: event.candidate }
      });
    };

    pc.ontrack = (event) => {
      const track = event.track;
      if (!track) return;
      console.log('[WebRTC] ontrack', { peerId: targetPeerId, kind: track.kind, readyState: track.readyState });

      setRemoteStreams((current) => {
        const existing = current[targetPeerId];
        const next = new MediaStream(existing ? existing.getTracks() : []);
        // Replace existing track of the same kind to avoid accumulating duplicates
        next.getTracks().forEach((t) => { if (t.kind === track.kind) next.removeTrack(t); });
        next.addTrack(track);
        return { ...current, [targetPeerId]: next };
      });

      track.onended = () => {
        setRemoteStreams((current) => {
          const ex = current[targetPeerId];
          if (!ex) return current;
          const remaining = ex.getTracks().filter((t) => t.id !== track.id && t.readyState === 'live');
          return { ...current, [targetPeerId]: new MediaStream(remaining) };
        });
      };
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[WebRTC] connectionState', { peerId: targetPeerId, state });

      if (state === 'connected') {
        clearFailedCleanupTimer(targetPeerId);
        return;
      }

      if (state === 'disconnected') {
        try { pc.restartIce(); } catch { /* no-op */ }
        return;
      }

      if (state === 'failed') {
        try { pc.restartIce(); } catch { /* no-op */ }
        if (!failedCleanupTimersRef.current.has(targetPeerId)) {
          const id = setTimeout(() => {
            failedCleanupTimersRef.current.delete(targetPeerId);
            const c = peersRef.current.get(targetPeerId);
            if (c?.connectionState === 'failed' || c?.connectionState === 'closed') {
              cleanupPeer(targetPeerId);
            }
          }, 15000);
          failedCleanupTimersRef.current.set(targetPeerId, id);
        }
        return;
      }

      if (state === 'closed') {
        cleanupPeer(targetPeerId);
      }
    };

    pc.ondatachannel = (event) => {
      if (event.channel.label !== POSE_CHANNEL_NAME) return;
      attachDataChannel(targetPeerId, event.channel);
    };

    // Only the initiating peer (lower ID) creates the DataChannel to avoid duplicates
    if (initiator) {
      const channel = pc.createDataChannel(POSE_CHANNEL_NAME, { ordered: true });
      attachDataChannel(targetPeerId, channel);
    }

    peersRef.current.set(targetPeerId, pc);
    return pc;
  }, [attachDataChannel, cleanupPeer, clearFailedCleanupTimer, iceServers]);

  // ─── connectToPeer ───────────────────────────────────────────────────────────
  // Only the peer with the LOWER peer ID sends the offer.
  // The higher-ID peer creates its RTCPeerConnection when the offer arrives
  // (inside the 'signal' handler below). This eliminates offer collisions.

  const connectToPeer = useCallback(async (targetPeerId) => {
    if (!targetPeerId || targetPeerId === peerIdRef.current) return;

    // Only the lower-ID peer initiates — the other side answers via signal handler
    const weInitiate = String(peerIdRef.current || '') < String(targetPeerId || '');
    if (!weInitiate) return;

    const pc = createPeerConnection(targetPeerId, /* initiator */ true);

    if (pc.connectionState === 'connected') return;
    if (pc.signalingState !== 'stable') return;

    makingOfferRef.current.set(targetPeerId, true);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signalingClientRef.current?.send('signal', {
        roomId: roomIdRef.current,
        targetPeerId,
        fromPeerId: peerIdRef.current || undefined,
        signal: { type: 'offer', sdp: pc.localDescription }
      });
    } finally {
      makingOfferRef.current.set(targetPeerId, false);
    }
  }, [createPeerConnection]);

  // ─── leaveRoom ───────────────────────────────────────────────────────────────

  const leaveRoom = useCallback(() => {
    if (signalingClientRef.current && roomIdRef.current) {
      signalingClientRef.current.send('leave-room', {
        roomId: roomIdRef.current,
        peerId: peerIdRef.current || undefined
      });
    }

    peersRef.current.forEach((_, targetPeerId) => cleanupPeer(targetPeerId));

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    localStreamRef.current = null;
    setLocalStream(null);
    setParticipants({});
    setRemoteStreams({});
    setHostId(null);
    setSpeakerId(null);
    setIsHost(false);
    setConnectionState('idle');
    setJoinedRoom('');
    setPeerId('');
    peerIdRef.current = '';
    hostHintRef.current = null;
    roomIdRef.current = '';
  }, [cleanupPeer]);

  // ─── ensureSignaling ─────────────────────────────────────────────────────────

  const ensureSignaling = useCallback(() => {
    if (signalingClientRef.current) return signalingClientRef.current;

    const client = new SignalingClient(signalingUrl);
    client.connect();

    // ── joined-room ──────────────────────────────────────────────────────────
    client.on('joined-room', ({
      roomId,
      peerId: assignedPeerId,
      peers,
      participants: joinedParticipants,
      hostId: roomHostId,
      speakerId: roomSpeakerId
    }) => {
      const resolvedHostId =
        String(roomHostId || '').trim() ||
        String(hostHintRef.current || '').trim() ||
        String(currentUserRef.current.userId || '').trim() ||
        null;

      roomIdRef.current = roomId;
      peerIdRef.current = assignedPeerId;
      setJoinedRoom(roomId);
      setPeerId(assignedPeerId);
      setHostId(resolvedHostId);
      setSpeakerId(roomSpeakerId || null);

      const nextParticipants = {};
      (joinedParticipants || []).forEach((p) => { nextParticipants[p.peerId] = p; });
      nextParticipants[assignedPeerId] = {
        peerId: assignedPeerId,
        userId: currentUserRef.current.userId || assignedPeerId,
        username:
          currentUserRef.current.username ||
          `User-${String(currentUserRef.current.userId || assignedPeerId).slice(0, 6)}`,
        isHost: Boolean(
          resolvedHostId && String(currentUserRef.current.userId || '') === String(resolvedHostId)
        )
      };

      setIsHost(Boolean(
        resolvedHostId && String(currentUserRef.current.userId || '') === String(resolvedHostId)
      ));
      setParticipants((current) => ({ ...current, ...nextParticipants }));
      setConnectionState('connected');

      if (pendingJoinRef.current) {
        settlePendingJoin(pendingJoinRef.current.resolve, { roomId, peerId: assignedPeerId });
      }

      // Only the lower-ID peer calls connectToPeer; the higher-ID peer will answer
      (peers || []).forEach((targetPeerId) => {
        connectToPeer(targetPeerId).catch(() => { /* transient race — safe to ignore */ });
      });
    });

    // ── peer-joined ──────────────────────────────────────────────────────────
    client.on('peer-joined', ({ participant, peerId: targetPeerId }) => {
      if (participant?.peerId) {
        setParticipants((current) => ({ ...current, [participant.peerId]: participant }));
      }

      const resolvedPeerId = participant?.peerId || targetPeerId;
      if (!resolvedPeerId || resolvedPeerId === peerIdRef.current) return;

      connectToPeer(resolvedPeerId).catch(() => { /* transient race — safe to ignore */ });
    });

    // ── peer-left ────────────────────────────────────────────────────────────
    client.on('peer-left', ({ peerId: targetPeerId }) => {
      cleanupPeer(targetPeerId);
      setParticipants((current) => {
        const next = { ...current };
        delete next[targetPeerId];
        return next;
      });
    });

    // ── speaker changed ──────────────────────────────────────────────────────
    client.on('SPEAKER_CHANGED', ({ speakerId: nextSpeakerId }) => {
      setSpeakerId(nextSpeakerId || null);
    });

    // ── pose packet via signaling fallback ───────────────────────────────────
    client.on('POSE_PACKET', ({ packet }) => {
      if (packet?.type === 'pose-sequence' && onPosePacketRef.current) {
        onPosePacketRef.current(packet);
      }
    });

    // ── signal (offer / answer / candidate) ─────────────────────────────────
    client.on('signal', async ({ fromPeerId, signal }) => {
      if (!fromPeerId || !signal) return;

      // Pose packet piggybacked on signal channel
      if (signal.type === 'pose-packet' && signal.packet) {
        if (onPosePacketRef.current) onPosePacketRef.current(signal.packet);
        return;
      }

      try {
        if (signal.type === 'offer') {
          // The answering peer (higher ID) creates its PC here on first offer receipt.
          // initiator=false so it does NOT create a duplicate DataChannel.
          const pc = createPeerConnection(fromPeerId, /* initiator */ false);

          // Guard against a stale re-offer while we already have a remote description.
          // Use implicit rollback (no-arg form) — far wider browser support than
          // setLocalDescription({ type: 'rollback' }).
          if (pc.signalingState !== 'stable') {
            try { await pc.setLocalDescription(); } catch { /* ignore */ }
          }

          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await flushPendingCandidates(fromPeerId, pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          client.send('signal', {
            roomId: roomIdRef.current,
            targetPeerId: fromPeerId,
            fromPeerId: peerIdRef.current || undefined,
            signal: { type: 'answer', sdp: pc.localDescription }
          });

        } else if (signal.type === 'answer') {
          const pc = peersRef.current.get(fromPeerId);
          if (!pc) return; // no connection for this peer — ignore stale answer

          // Only apply an answer when we are actually waiting for one
          if (pc.signalingState !== 'have-local-offer') {
            console.warn('[WebRTC] Ignoring answer in unexpected signalingState', pc.signalingState);
            return;
          }

          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await flushPendingCandidates(fromPeerId, pc);

        } else if (signal.type === 'candidate' && signal.candidate) {
          // The PC may not exist yet if candidates race ahead of the offer on the
          // answering side — queue them; flushPendingCandidates drains the queue
          // after setRemoteDescription.
          const pc = peersRef.current.get(fromPeerId);
          const candidate = new RTCIceCandidate(signal.candidate);

          if (pc?.remoteDescription?.type) {
            await pc.addIceCandidate(candidate);
          } else {
            queuePendingCandidate(fromPeerId, candidate);
          }
        }
      } catch (error) {
        console.error('[WebRTC] signal handling failed', {
          fromPeerId,
          signalType: signal?.type,
          error
        });
        // Do NOT tear down the peer — transient ICE/signaling ordering races are normal.
      }
    });

    // ── error ────────────────────────────────────────────────────────────────
    client.on('error', ({ message }) => {
      setConnectionState('error');
      if (pendingJoinRef.current) {
        settlePendingJoin(
          pendingJoinRef.current.reject,
          new Error(message || 'Unable to join room')
        );
      }
    });

    signalingClientRef.current = client;
    return client;
  }, [cleanupPeer, connectToPeer, createPeerConnection, flushPendingCandidates, queuePendingCandidate, settlePendingJoin, signalingUrl]);

  // ─── joinRoom ────────────────────────────────────────────────────────────────

  const joinRoom = useCallback(async (roomId, options = {}) => {
    if (!roomId) throw new Error('Room ID is required');

    if (pendingJoinRef.current) {
      settlePendingJoin(
        pendingJoinRef.current.reject,
        new Error('Previous join attempt was replaced by a new attempt.')
      );
    }

    setConnectionState('connecting');

    let stream = null;
    const supportsGetUserMedia =
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

    if (supportsGetUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch {
        stream = new MediaStream();
      }
    } else {
      stream = new MediaStream();
    }

    const audioEnabled = options?.audioEnabled ?? true;
    const videoEnabled = options?.videoEnabled ?? true;
    stream.getAudioTracks().forEach((t) => { t.enabled = audioEnabled; });
    stream.getVideoTracks().forEach((t) => { t.enabled = videoEnabled; });

    localStreamRef.current = stream;
    setLocalStream(stream);

    const client = ensureSignaling();
    hostHintRef.current = options?.hostId || null;
    setHostId(options?.hostId || null);
    setIsHost(Boolean(options?.hostId && options?.userId && options.hostId === options.userId));
    currentUserRef.current = {
      userId: options?.userId || null,
      username: options?.username || null
    };

    const joinAck = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pendingJoinRef.current) return;
        pendingJoinRef.current = null;
        setConnectionState('error');
        reject(new Error('Signaling server did not confirm join. Please try again.'));
      }, JOIN_ACK_TIMEOUT_MS);

      pendingJoinRef.current = { resolve, reject, timeoutId };
    });

    client.send('join-room', {
      roomId,
      peerId: peerId || undefined,
      userId: options?.userId || undefined,
      username: options?.username || undefined,
      hostId: options?.hostId || undefined
    });

    await joinAck;
  }, [ensureSignaling, peerId, settlePendingJoin]);

  // ─── setSpeaker ──────────────────────────────────────────────────────────────

  const setSpeaker = useCallback((nextSpeakerId) => {
    if (!signalingClientRef.current || !roomIdRef.current) return;
    setSpeakerId(nextSpeakerId || null);
    signalingClientRef.current.send('set-speaker', {
      roomId: roomIdRef.current,
      requesterUserId: currentUserRef.current.userId || undefined,
      speakerId: nextSpeakerId || null
    });
  }, []);

  // ─── sendPosePacket ──────────────────────────────────────────────────────────

  const sendPosePacket = useCallback((packet) => {
    const encoded = encodePosePacket(packet);
    // Primary path: WebRTC data channels (low-latency, peer-to-peer)
    dataChannelsRef.current.forEach((channel) => {
      if (channel.readyState === 'open') channel.send(encoded);
    });

    // Fallback path: relay via signaling server for peers whose data channel
    // is not yet open (e.g. during ICE negotiation).
    if (signalingClientRef.current && roomIdRef.current) {
      peersRef.current.forEach((_, targetPeerId) => {
        signalingClientRef.current.send('signal', {
          roomId: roomIdRef.current,
          targetPeerId,
          fromPeerId: peerIdRef.current || undefined,
          signal: { type: 'pose-packet', packet }
        });
      });

      signalingClientRef.current.send('pose-packet', {
        roomId: roomIdRef.current,
        packet
      });
    }
  }, []);

  // ─── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => () => {
    if (pendingJoinRef.current) {
      settlePendingJoin(pendingJoinRef.current.reject, new Error('Join cancelled'));
    }
    leaveRoom();
    if (signalingClientRef.current) {
      signalingClientRef.current.close();
      signalingClientRef.current = null;
    }
  }, [leaveRoom, settlePendingJoin]);

  // ─── Public API ──────────────────────────────────────────────────────────────

  return {
    localStream,
    remoteStreams,
    participants,
    peerId,
    hostId,
    speakerId,
    isHost,
    joinedRoom,
    connectionState,
    joinRoom,
    leaveRoom,
    setSpeaker,
    sendPosePacket
  };
}
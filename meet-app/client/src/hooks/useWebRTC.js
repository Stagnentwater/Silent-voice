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
  if (!fromEnv) {
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(fromEnv);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
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
  const ignoreOfferRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const failedCleanupTimersRef = useRef(new Map());
  const pendingJoinRef = useRef(null);
  const iceServers = useMemo(parseIceServers, []);

  const settlePendingJoin = useCallback((resolver, payloadOrError) => {
    if (!pendingJoinRef.current) {
      return;
    }

    const { timeoutId } = pendingJoinRef.current;
    clearTimeout(timeoutId);
    pendingJoinRef.current = null;
    resolver(payloadOrError);
  }, []);

  const upsertRemoteStreamTracks = useCallback((targetPeerId, tracks = []) => {
    const validTracks = tracks.filter((track) => track && track.readyState === 'live');

    if (!validTracks.length) {
      return;
    }

    setRemoteStreams((current) => {
      const existing = current[targetPeerId];
      const nextStream = new MediaStream(existing ? existing.getTracks() : []);
      const existingIds = new Set(nextStream.getTracks().map((track) => track.id));

      validTracks.forEach((track) => {
        if (!existingIds.has(track.id)) {
          nextStream.addTrack(track);
          existingIds.add(track.id);
        }
      });

      return {
        ...current,
        [targetPeerId]: nextStream
      };
    });
  }, []);

  const clearFailedCleanupTimer = useCallback((targetPeerId) => {
    const timeoutId = failedCleanupTimersRef.current.get(targetPeerId);
    if (timeoutId) {
      clearTimeout(timeoutId);
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
    if (!queue || !queue.length) {
      return;
    }

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
      connection.close();
    }

    const channel = dataChannelsRef.current.get(targetPeerId);
    if (channel) {
      channel.onmessage = null;
      channel.onopen = null;
      channel.onclose = null;
      channel.close();
    }

    peersRef.current.delete(targetPeerId);
    dataChannelsRef.current.delete(targetPeerId);
    makingOfferRef.current.delete(targetPeerId);
    ignoreOfferRef.current.delete(targetPeerId);
    pendingCandidatesRef.current.delete(targetPeerId);

    setParticipants((current) => {
      const next = { ...current };
      delete next[targetPeerId];
      return next;
    });

    setRemoteStreams((current) => {
      const next = { ...current };
      delete next[targetPeerId];
      return next;
    });
  }, [clearFailedCleanupTimer]);

  const attachDataChannel = useCallback((targetPeerId, channel) => {
    channel.onmessage = (event) => {
      const decoded = decodePosePacket(event.data);
      if (decoded && onPosePacket) {
        onPosePacket(decoded);
      }
    };
    channel.onopen = () => {
      dataChannelsRef.current.set(targetPeerId, channel);
    };
    channel.onclose = () => {
      dataChannelsRef.current.delete(targetPeerId);
    };
  }, [onPosePacket]);

  const createPeerConnection = useCallback((targetPeerId, initiator) => {
    const existing = peersRef.current.get(targetPeerId);
    if (existing) {
      return existing;
    }

    const peerConnection = new RTCPeerConnection({ iceServers });

    const localTracks = localStreamRef.current?.getTracks?.() || [];
    if (localTracks.length > 0) {
      localTracks.forEach((track) => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    } else {
      try {
        peerConnection.addTransceiver('audio', { direction: 'recvonly' });
        peerConnection.addTransceiver('video', { direction: 'recvonly' });
      } catch {
        // Ignore transceiver setup failures for older browser implementations.
      }
    }

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !signalingClientRef.current) {
        return;
      }
      signalingClientRef.current.send('signal', {
        roomId: roomIdRef.current,
        targetPeerId,
        fromPeerId: peerIdRef.current || undefined,
        signal: { type: 'candidate', candidate: event.candidate }
      });
    };

    peerConnection.ontrack = (event) => {
      const [incoming] = event.streams;
      const streamTracks = incoming ? incoming.getTracks() : [];
      const track = event.track;

      upsertRemoteStreamTracks(targetPeerId, [...streamTracks, track]);

      if (track) {
        track.onended = () => {
          setRemoteStreams((current) => {
            const existing = current[targetPeerId];
            if (!existing) {
              return current;
            }

            const remainingTracks = existing
              .getTracks()
              .filter((existingTrack) => existingTrack.id !== track.id && existingTrack.readyState === 'live');

            if (!remainingTracks.length) {
              const next = { ...current };
              delete next[targetPeerId];
              return next;
            }

            return {
              ...current,
              [targetPeerId]: new MediaStream(remainingTracks)
            };
          });
        };
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;

      if (state === 'connected') {
        clearFailedCleanupTimer(targetPeerId);
        return;
      }

      if (state === 'failed' || state === 'disconnected') {
        try {
          peerConnection.restartIce();
        } catch {
          // no-op
        }

        if (!failedCleanupTimersRef.current.has(targetPeerId)) {
          const timeoutId = setTimeout(() => {
            failedCleanupTimersRef.current.delete(targetPeerId);
            const connection = peersRef.current.get(targetPeerId);
            const finalState = connection?.connectionState;
            if (finalState === 'failed' || finalState === 'disconnected' || finalState === 'closed') {
              cleanupPeer(targetPeerId);
            }
          }, 6000);

          failedCleanupTimersRef.current.set(targetPeerId, timeoutId);
        }

        return;
      }

      if (state === 'closed') {
        cleanupPeer(targetPeerId);
      }
    };

    peerConnection.ondatachannel = (event) => {
      if (event.channel.label !== POSE_CHANNEL_NAME) {
        return;
      }
      attachDataChannel(targetPeerId, event.channel);
    };

    if (initiator) {
      const channel = peerConnection.createDataChannel(POSE_CHANNEL_NAME, {
        ordered: true
      });
      attachDataChannel(targetPeerId, channel);
    }

    peersRef.current.set(targetPeerId, peerConnection);
    return peerConnection;
  }, [attachDataChannel, cleanupPeer, clearFailedCleanupTimer, iceServers, upsertRemoteStreamTracks]);

  const connectToPeer = useCallback(async (targetPeerId) => {
    const peerConnection = createPeerConnection(targetPeerId, true);
    if (peerConnection.signalingState !== 'stable') {
      return;
    }

    makingOfferRef.current.set(targetPeerId, true);
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      signalingClientRef.current?.send('signal', {
        roomId: roomIdRef.current,
        targetPeerId,
        fromPeerId: peerIdRef.current || undefined,
        signal: {
          type: 'offer',
          sdp: peerConnection.localDescription
        }
      });
    } finally {
      makingOfferRef.current.set(targetPeerId, false);
    }
  }, [createPeerConnection]);

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

  const ensureSignaling = useCallback(() => {
    if (signalingClientRef.current) {
      return signalingClientRef.current;
    }

    const client = new SignalingClient(signalingUrl);
    client.connect();

    client.on('joined-room', ({ roomId, peerId: assignedPeerId, peers, participants: joinedParticipants, hostId: roomHostId, speakerId: roomSpeakerId }) => {
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
      (joinedParticipants || []).forEach((participant) => {
        nextParticipants[participant.peerId] = participant;
      });
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

      setIsHost(
        Boolean(
          resolvedHostId && String(currentUserRef.current.userId || '') === String(resolvedHostId)
        )
      );

      setParticipants((current) => ({
        ...current,
        ...nextParticipants
      }));

      setConnectionState('connected');

      if (pendingJoinRef.current) {
        settlePendingJoin(pendingJoinRef.current.resolve, {
          roomId,
          peerId: assignedPeerId
        });
      }

      (peers || []).forEach((targetPeerId) => {
        connectToPeer(targetPeerId).catch(() => {
          cleanupPeer(targetPeerId);
        });
      });
    });

    client.on('peer-joined', ({ participant, peerId: targetPeerId }) => {
      if (participant?.peerId) {
        setParticipants((current) => ({
          ...current,
          [participant.peerId]: participant
        }));
      }

      const resolvedPeerId = participant?.peerId || targetPeerId;
      if (!resolvedPeerId || resolvedPeerId === peerIdRef.current) {
        return;
      }

      connectToPeer(resolvedPeerId).catch(() => {
        cleanupPeer(resolvedPeerId);
      });
    });

    client.on('peer-left', ({ peerId: targetPeerId }) => {
      cleanupPeer(targetPeerId);
    });

    client.on('SPEAKER_CHANGED', ({ speakerId: nextSpeakerId }) => {
      setSpeakerId(nextSpeakerId || null);
    });

    client.on('POSE_PACKET', ({ packet }) => {
      if (packet?.type === 'pose-sequence' && onPosePacket) {
        onPosePacket(packet);
      }
    });

    client.on('signal', async ({ fromPeerId, signal }) => {
      if (!fromPeerId || !signal) {
        return;
      }

      if (signal.type === 'pose-packet' && signal.packet) {
        if (onPosePacket) {
          onPosePacket(signal.packet);
        }
        return;
      }

      try {
        const initiator = false;
        const peerConnection = createPeerConnection(fromPeerId, initiator);
        const polite = String(peerIdRef.current || '') > String(fromPeerId || '');

        if (signal.type === 'offer') {
          const makingOffer = makingOfferRef.current.get(fromPeerId) === true;
          const offerCollision = makingOffer || peerConnection.signalingState !== 'stable';
          const shouldIgnoreOffer = !polite && offerCollision;
          ignoreOfferRef.current.set(fromPeerId, shouldIgnoreOffer);

          if (shouldIgnoreOffer) {
            return;
          }

          if (offerCollision) {
            try {
              await peerConnection.setLocalDescription({ type: 'rollback' });
            } catch {
              // no-op
            }
          }

          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await flushPendingCandidates(fromPeerId, peerConnection);

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          client.send('signal', {
            roomId: roomIdRef.current,
            targetPeerId: fromPeerId,
            fromPeerId: peerIdRef.current || undefined,
            signal: {
              type: 'answer',
              sdp: peerConnection.localDescription
            }
          });
        } else if (signal.type === 'answer') {
          ignoreOfferRef.current.set(fromPeerId, false);
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await flushPendingCandidates(fromPeerId, peerConnection);
        } else if (signal.type === 'candidate' && signal.candidate) {
          if (ignoreOfferRef.current.get(fromPeerId)) {
            return;
          }

          const candidate = new RTCIceCandidate(signal.candidate);
          if (peerConnection.remoteDescription?.type) {
            await peerConnection.addIceCandidate(candidate);
          } else {
            queuePendingCandidate(fromPeerId, candidate);
          }
        }
      } catch {
        // Avoid tearing down immediately for transient signaling/ICE ordering races.
      }
    });

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

  const joinRoom = useCallback(async (roomId, options = {}) => {
    if (!roomId) {
      throw new Error('Room ID is required');
    }

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
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
      } catch {
        stream = new MediaStream();
      }
    } else {
      stream = new MediaStream();
    }

    const audioEnabled = options?.audioEnabled ?? true;
    const videoEnabled = options?.videoEnabled ?? true;

    stream.getAudioTracks().forEach((track) => {
      track.enabled = audioEnabled;
    });

    stream.getVideoTracks().forEach((track) => {
      track.enabled = videoEnabled;
    });

    localStreamRef.current = stream;
    setLocalStream(stream);

    const client = ensureSignaling();
    const nextHostId = options?.hostId || null;
    hostHintRef.current = nextHostId;
    setHostId(nextHostId);
    setIsHost(Boolean(nextHostId && options?.userId && nextHostId === options.userId));
    currentUserRef.current = {
      userId: options?.userId || null,
      username: options?.username || null
    };

    const joinAck = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pendingJoinRef.current) {
          return;
        }

        pendingJoinRef.current = null;
        setConnectionState('error');
        reject(new Error('Signaling server did not confirm join. Please try again.'));
      }, JOIN_ACK_TIMEOUT_MS);

      pendingJoinRef.current = {
        resolve,
        reject,
        timeoutId
      };
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

  const setSpeaker = useCallback((nextSpeakerId) => {
    if (!signalingClientRef.current || !roomIdRef.current) {
      return;
    }

    setSpeakerId(nextSpeakerId || null);

    signalingClientRef.current.send('set-speaker', {
      roomId: roomIdRef.current,
      requesterUserId: currentUserRef.current.userId || undefined,
      speakerId: nextSpeakerId || null
    });
  }, []);

  const sendPosePacket = useCallback((packet) => {
    const encoded = encodePosePacket(packet);
    dataChannelsRef.current.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(encoded);
      }
    });

    if (signalingClientRef.current && roomIdRef.current) {
      peersRef.current.forEach((_, targetPeerId) => {
        signalingClientRef.current.send('signal', {
          roomId: roomIdRef.current,
          targetPeerId,
          fromPeerId: peerIdRef.current || undefined,
          signal: {
            type: 'pose-packet',
            packet
          }
        });
      });
    }

    if (signalingClientRef.current && roomIdRef.current) {
      signalingClientRef.current.send('pose-packet', {
        roomId: roomIdRef.current,
        packet
      });
    }
  }, []);

  useEffect(() => () => {
    if (pendingJoinRef.current) {
      settlePendingJoin(
        pendingJoinRef.current.reject,
        new Error('Join cancelled')
      );
    }

    leaveRoom();
    if (signalingClientRef.current) {
      signalingClientRef.current.close();
      signalingClientRef.current = null;
    }
  }, [leaveRoom, settlePendingJoin]);

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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignalingClient } from '../webrtc/signalingClient.js';
import {
  POSE_CHANNEL_NAME,
  decodePosePacket,
  encodePosePacket
} from '../services/poseChannel.js';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const WEBRTC_DIAG_PREFIX = '[WebRTC-DIAG]';

function summarizeTrack(track) {
  if (!track) {
    return null;
  }

  return {
    id: track.id,
    kind: track.kind,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState
  };
}

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
  const pendingJoinRef = useRef(null);
  const iceServers = useMemo(parseIceServers, []);

  const settlePendingJoin = useCallback((resolver, payloadOrError) => {
    if (!pendingJoinRef.current) {
      return;
    }

    const { timeoutId } = pendingJoinRef.current;
    clearTimeout(timeoutId);
    pendingJoinRef.current = null;
    console.log(WEBRTC_DIAG_PREFIX, 'settlePendingJoin', {
      resolvedWithError: payloadOrError instanceof Error,
      value: payloadOrError instanceof Error ? payloadOrError.message : payloadOrError
    });
    resolver(payloadOrError);
  }, []);

  const upsertRemoteStreamTracks = useCallback((targetPeerId, tracks = []) => {
    const validTracks = tracks.filter((track) => track && track.readyState === 'live');

    if (!validTracks.length) {
      console.warn(WEBRTC_DIAG_PREFIX, 'upsertRemoteStreamTracks: no live tracks', {
        targetPeerId,
        incomingCount: tracks.length,
        incoming: tracks.map((track) => summarizeTrack(track))
      });
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

      console.log(WEBRTC_DIAG_PREFIX, 'upsertRemoteStreamTracks: updated stream', {
        targetPeerId,
        hadExisting: Boolean(existing),
        incoming: validTracks.map((track) => summarizeTrack(track)),
        finalTracks: nextStream.getTracks().map((track) => summarizeTrack(track))
      });

      return {
        ...current,
        [targetPeerId]: nextStream
      };
    });
  }, []);

  const cleanupPeer = useCallback((targetPeerId) => {
    console.warn(WEBRTC_DIAG_PREFIX, 'cleanupPeer', {
      targetPeerId,
      hadPeerConnection: peersRef.current.has(targetPeerId),
      hadDataChannel: dataChannelsRef.current.has(targetPeerId)
    });

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
  }, []);

  const attachDataChannel = useCallback((targetPeerId, channel) => {
    channel.onmessage = (event) => {
      const decoded = decodePosePacket(event.data);
      if (decoded && onPosePacket) {
        onPosePacket(decoded);
      }
    };
    channel.onopen = () => {
      console.log(WEBRTC_DIAG_PREFIX, 'data channel open', {
        targetPeerId,
        label: channel.label,
        readyState: channel.readyState
      });
      dataChannelsRef.current.set(targetPeerId, channel);
    };
    channel.onclose = () => {
      console.warn(WEBRTC_DIAG_PREFIX, 'data channel closed', {
        targetPeerId,
        label: channel.label,
        readyState: channel.readyState
      });
      dataChannelsRef.current.delete(targetPeerId);
    };
  }, [onPosePacket]);

  const createPeerConnection = useCallback((targetPeerId, initiator) => {
    const existing = peersRef.current.get(targetPeerId);
    if (existing) {
      console.log(WEBRTC_DIAG_PREFIX, 'createPeerConnection: reusing existing', {
        targetPeerId,
        initiator
      });
      return existing;
    }

    console.log(WEBRTC_DIAG_PREFIX, 'createPeerConnection: creating', {
      targetPeerId,
      initiator,
      iceServers
    });

    const peerConnection = new RTCPeerConnection({ iceServers });

    try {
      peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
      peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    } catch {
      // Ignore transceiver setup failures for older browser implementations.
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
      console.log(WEBRTC_DIAG_PREFIX, 'createPeerConnection: added local tracks', {
        targetPeerId,
        localTracks: localStreamRef.current.getTracks().map((track) => summarizeTrack(track))
      });
    } else {
      console.warn(WEBRTC_DIAG_PREFIX, 'createPeerConnection: localStream missing', {
        targetPeerId
      });
    }

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !signalingClientRef.current) {
        return;
      }
      console.log(WEBRTC_DIAG_PREFIX, 'onicecandidate', {
        targetPeerId,
        candidateType: event.candidate.type,
        sdpMid: event.candidate.sdpMid
      });
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

      console.log(WEBRTC_DIAG_PREFIX, 'ontrack', {
        targetPeerId,
        track: summarizeTrack(track),
        incomingStreamTrackCount: streamTracks.length,
        incomingStreamTracks: streamTracks.map((item) => summarizeTrack(item))
      });

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

            console.warn(WEBRTC_DIAG_PREFIX, 'remote track ended', {
              targetPeerId,
              endedTrack: summarizeTrack(track),
              remainingTracks: remainingTracks.map((item) => summarizeTrack(item))
            });

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
      console.log(WEBRTC_DIAG_PREFIX, 'connection state changed', {
        targetPeerId,
        state,
        iceConnectionState: peerConnection.iceConnectionState,
        signalingState: peerConnection.signalingState
      });
      if (state === 'failed' || state === 'closed') {
        cleanupPeer(targetPeerId);
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(WEBRTC_DIAG_PREFIX, 'ice connection state changed', {
        targetPeerId,
        iceConnectionState: peerConnection.iceConnectionState
      });
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
  }, [attachDataChannel, cleanupPeer, iceServers, upsertRemoteStreamTracks]);

  const connectToPeer = useCallback(async (targetPeerId) => {
    console.log(WEBRTC_DIAG_PREFIX, 'connectToPeer: start', {
      targetPeerId,
      roomId: roomIdRef.current,
      fromPeerId: peerIdRef.current
    });
    const peerConnection = createPeerConnection(targetPeerId, true);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    console.log(WEBRTC_DIAG_PREFIX, 'connectToPeer: offer created', {
      targetPeerId,
      type: peerConnection.localDescription?.type
    });

    signalingClientRef.current?.send('signal', {
      roomId: roomIdRef.current,
      targetPeerId,
      fromPeerId: peerIdRef.current || undefined,
      signal: {
        type: 'offer',
        sdp: peerConnection.localDescription
      }
    });
  }, [createPeerConnection]);

  const leaveRoom = useCallback(() => {
    console.log(WEBRTC_DIAG_PREFIX, 'leaveRoom', {
      roomId: roomIdRef.current,
      peerId: peerIdRef.current,
      remotePeerCount: peersRef.current.size
    });
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
    console.log(WEBRTC_DIAG_PREFIX, 'ensureSignaling: connect', {
      signalingUrl
    });
    client.connect();

    client.on('joined-room', ({ roomId, peerId: assignedPeerId, peers, participants: joinedParticipants, hostId: roomHostId, speakerId: roomSpeakerId }) => {
      console.log(WEBRTC_DIAG_PREFIX, 'joined-room', {
        roomId,
        assignedPeerId,
        peers,
        participantsCount: (joinedParticipants || []).length,
        hostId: roomHostId,
        speakerId: roomSpeakerId
      });
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
      console.log(WEBRTC_DIAG_PREFIX, 'peer-joined', {
        participant,
        targetPeerId
      });
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
      console.warn(WEBRTC_DIAG_PREFIX, 'peer-left', {
        targetPeerId
      });
      cleanupPeer(targetPeerId);
    });

    client.on('SPEAKER_CHANGED', ({ speakerId: nextSpeakerId }) => {
      console.log(WEBRTC_DIAG_PREFIX, 'SPEAKER_CHANGED', {
        nextSpeakerId
      });
      setSpeakerId(nextSpeakerId || null);
    });

    client.on('POSE_PACKET', ({ packet }) => {
      if (packet?.type === 'pose-sequence' && onPosePacket) {
        onPosePacket(packet);
      }
    });

    client.on('signal', async ({ fromPeerId, signal }) => {
      console.log(WEBRTC_DIAG_PREFIX, 'signal received', {
        fromPeerId,
        type: signal?.type
      });
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

        if (signal.type === 'offer') {
          console.log(WEBRTC_DIAG_PREFIX, 'processing offer', { fromPeerId });
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
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
          console.log(WEBRTC_DIAG_PREFIX, 'processing answer', { fromPeerId });
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.type === 'candidate' && signal.candidate) {
          console.log(WEBRTC_DIAG_PREFIX, 'processing candidate', {
            fromPeerId,
            candidateType: signal.candidate.type
          });
          await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (error) {
        console.error(WEBRTC_DIAG_PREFIX, 'signal handling failed', {
          fromPeerId,
          type: signal?.type,
          error
        });
        cleanupPeer(fromPeerId);
      }
    });

    client.on('error', ({ message }) => {
      console.error(WEBRTC_DIAG_PREFIX, 'signaling error', {
        message
      });
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
  }, [cleanupPeer, connectToPeer, createPeerConnection, settlePendingJoin, signalingUrl]);

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

    console.log(WEBRTC_DIAG_PREFIX, 'joinRoom: start', {
      roomId,
      options,
      hasPendingJoin: Boolean(pendingJoinRef.current)
    });

    let stream = null;
    const supportsGetUserMedia =
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

    if (supportsGetUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        console.log(WEBRTC_DIAG_PREFIX, 'getUserMedia success', {
          audioTracks: stream.getAudioTracks().map((track) => summarizeTrack(track)),
          videoTracks: stream.getVideoTracks().map((track) => summarizeTrack(track))
        });
      } catch {
        console.error(WEBRTC_DIAG_PREFIX, 'getUserMedia failed: using empty MediaStream');
        stream = new MediaStream();
      }
    } else {
      console.warn(WEBRTC_DIAG_PREFIX, 'getUserMedia unsupported: using empty MediaStream');
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
        console.error(WEBRTC_DIAG_PREFIX, 'joinRoom: ack timeout', {
          roomId,
          timeoutMs: JOIN_ACK_TIMEOUT_MS
        });
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

    console.log(WEBRTC_DIAG_PREFIX, 'joinRoom: join-room sent', {
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
      console.warn(WEBRTC_DIAG_PREFIX, 'setSpeaker skipped: missing signaling/room', {
        nextSpeakerId,
        hasSignaling: Boolean(signalingClientRef.current),
        roomId: roomIdRef.current
      });
      return;
    }

    console.log(WEBRTC_DIAG_PREFIX, 'setSpeaker', {
      roomId: roomIdRef.current,
      requesterUserId: currentUserRef.current.userId || undefined,
      nextSpeakerId: nextSpeakerId || null
    });

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

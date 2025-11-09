import { useEffect, useState, useCallback, useRef } from 'react';
import { WebRTCManager, Peer, Message, FileTransfer } from '../utils/webrtc';
import { LocalSignalingServer, SignalingMessage } from '../utils/signaling';

export function useLocalNetwork(userName: string, roomId?: string) {
    console.log('useLocalNetwork called with userName:', userName || '(empty)', 'roomId:', roomId);

    const webrtcRef = useRef<WebRTCManager | null>(null);
    const signalingRef = useRef<LocalSignalingServer | null>(null);
    const initializingRef = useRef(false);

    if (!webrtcRef.current && userName) {
        webrtcRef.current = new WebRTCManager(userName || 'Guest');
        console.log('Created WebRTCManager with peer ID:', webrtcRef.current.getLocalPeerId());
    }

    if (!signalingRef.current && userName && webrtcRef.current) {
        signalingRef.current = new LocalSignalingServer(
            webrtcRef.current.getLocalPeerId(),
            userName || 'Guest'
        );
        console.log('Created LocalSignalingServer');
    }

    const [peers, setPeers] = useState<Peer[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [fileTransfers, setFileTransfers] = useState<FileTransfer[]>([]);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);

    useEffect(() => {
        if (!userName || !webrtcRef.current || !signalingRef.current) {
            console.log('Waiting for username...');
            return;
        }

        if (initializingRef.current) {
            console.log('Already initializing...');
            return;
        }

        initializingRef.current = true;
        let isActive = true;
        const webrtc = webrtcRef.current;
        const signaling = signalingRef.current;
        const peersRef = new Map<string, Peer>();
        const pendingConnections = new Set<string>();

        webrtc.setOnPeerUpdate((updatedPeers) => {
            if (!isActive) return;
            setPeers([...updatedPeers]);
            updatedPeers.forEach(p => peersRef.set(p.id, p));
        });

        webrtc.setOnMessage((message) => {
            if (!isActive) return;
            setMessages(prev => [...prev, message]);
        });

        webrtc.setOnFileTransfer((transfer) => {
            if (!isActive) return;
            setFileTransfers(prev => [...prev, transfer]);
        });

        signaling.setOnSignal(async (message: SignalingMessage) => {
            if (!isActive) return;

            console.log('Received signal:', message.type, 'from:', message.fromName);

            if (message.type === 'peer-discovery') {
                const existingPeer = peersRef.get(message.from);

                const shouldInitiate = !existingPeer &&
                    !pendingConnections.has(message.from) &&
                    webrtc.getLocalPeerId() > message.from;

                if (shouldInitiate) {
                    console.log('New peer discovered, initiating connection:', message.fromName);
                    pendingConnections.add(message.from);

                    try {
                        const peerConnection = await webrtc.createPeerConnection(message.from, message.fromName);

                        peerConnection.onicecandidate = (event) => {
                            if (event.candidate && isActive) {
                                signaling.send({
                                    type: 'ice-candidate',
                                    to: message.from,
                                    data: event.candidate,
                                });
                            }
                        };

                        const offer = await peerConnection.createOffer();
                        await peerConnection.setLocalDescription(offer);

                        signaling.send({
                            type: 'offer',
                            to: message.from,
                            data: offer,
                        });

                        console.log('Sent offer to:', message.fromName);
                    } catch (error) {
                        console.error('Error creating offer:', error);
                        pendingConnections.delete(message.from);
                    }
                } else if (!existingPeer) {
                    console.log('Waiting for offer from:', message.fromName);
                }
            } else if (message.type === 'offer') {
                console.log('Received offer from:', message.fromName);

                try {
                    let peerConnection = peersRef.get(message.from)?.connection;

                    if (!peerConnection) {
                        peerConnection = await webrtc.createPeerConnection(message.from, message.fromName);
                    }

                    if (peerConnection.signalingState === 'stable' ||
                        peerConnection.signalingState === 'have-local-offer') {

                        await peerConnection.setRemoteDescription(
                            new RTCSessionDescription(message.data as RTCSessionDescriptionInit)
                        );

                        const answer = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answer);

                        signaling.send({
                            type: 'answer',
                            to: message.from,
                            data: answer,
                        });

                        peerConnection.onicecandidate = (event) => {
                            if (event.candidate && isActive) {
                                signaling.send({
                                    type: 'ice-candidate',
                                    to: message.from,
                                    data: event.candidate,
                                });
                            }
                        };

                        console.log('Sent answer to:', message.fromName);
                    } else {
                        console.warn('Invalid state for offer:', peerConnection.signalingState);
                    }
                } catch (error) {
                    console.error('Error handling offer:', error);
                }
            } else if (message.type === 'answer') {
                console.log('Received answer from:', message.fromName);

                const peer = peersRef.get(message.from);
                if (peer?.connection) {
                    try {
                        if (peer.connection.signalingState === 'have-local-offer') {
                            await peer.connection.setRemoteDescription(
                                new RTCSessionDescription(message.data as RTCSessionDescriptionInit)
                            );
                            pendingConnections.delete(message.from);
                            console.log('Connection established with:', message.fromName);
                        } else {
                            console.warn('Invalid state for answer:', peer.connection.signalingState);
                        }
                    } catch (error) {
                        console.error('Error setting remote description:', error);
                    }
                }
            } else if (message.type === 'ice-candidate') {
                const peer = peersRef.get(message.from);
                if (peer?.connection) {
                    try {
                        await peer.connection.addIceCandidate(
                            new RTCIceCandidate(message.data as RTCIceCandidateInit)
                        );
                        console.log('Added ICE candidate from:', message.fromName);
                    } catch (error) {
                        console.error('Error adding ICE candidate:', error);
                    }
                }
            }
        });

        const discoveryInterval = setInterval(() => {
            if (isActive) {
                signaling.broadcast('peer-discovery');
                console.log('Broadcasting discovery...');
            }
        }, 3000);

        if (isActive) {
            signaling.broadcast('peer-discovery');
            console.log('Initial discovery broadcast sent');
        }

        return () => {
            console.log('Cleaning up...');
            isActive = false;
            initializingRef.current = false;
            clearInterval(discoveryInterval);
        };
    }, [userName, roomId]);

    const startVideo = useCallback(async () => {
        if (!webrtcRef.current) return;

        try {
            const stream = await webrtcRef.current.initLocalStream(true, true);
            setLocalStream(stream);
            console.log('Video started');
        } catch (error) {
            console.error('Failed to start video:', error);

            try {
                console.log('Trying audio-only...');
                const stream = await webrtcRef.current.initLocalStream(false, true);
                setLocalStream(stream);
                setIsVideoEnabled(false);
                console.log('Audio-only mode active');
            } catch (audioError) {
                console.error('Failed to start audio:', audioError);
                console.log('Continuing without media devices');
            }
        }
    }, []);

    const sendMessage = useCallback((content: string) => {
        webrtcRef.current?.sendMessage(content);
    }, []);

    const sendFile = useCallback((file: File) => {
        webrtcRef.current?.sendFile(file);
    }, []);

    const toggleAudio = useCallback(() => {
        if (!webrtcRef.current) return;
        const newState = !isAudioEnabled;
        webrtcRef.current.toggleAudio(newState);
        setIsAudioEnabled(newState);
    }, [isAudioEnabled]);

    const toggleVideo = useCallback(() => {
        if (!webrtcRef.current) return;
        const newState = !isVideoEnabled;
        webrtcRef.current.toggleVideo(newState);
        setIsVideoEnabled(newState);
    }, [isVideoEnabled]);

    const cleanup = useCallback(() => {
        console.log('Cleanup called');
        webrtcRef.current?.cleanup();
        signalingRef.current?.close();
    }, []);

    return {
        peers,
        messages,
        fileTransfers,
        localStream,
        isAudioEnabled,
        isVideoEnabled,
        startVideo,
        sendMessage,
        sendFile,
        toggleAudio,
        toggleVideo,
        cleanup,
        localPeerId: webrtcRef.current?.getLocalPeerId() || '',
        localPeerName: webrtcRef.current?.getLocalPeerName() || '',
    };
}
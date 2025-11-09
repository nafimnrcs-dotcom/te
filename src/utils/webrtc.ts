export interface Peer {
    id: string;
    name: string;
    connection?: RTCPeerConnection;
    dataChannel?: RTCDataChannel;
    stream?: MediaStream;
}

export interface Message {
    id: string;
    peerId: string;
    peerName: string;
    content: string;
    timestamp: number;
    type: 'text' | 'file';
}

export interface FileTransfer {
    id: string;
    name: string;
    size: number;
    progress: number;
    peerId: string;
    peerName: string;
}

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
    ],
};

export class WebRTCManager {
    private localStream: MediaStream | null = null;
    private peers: Map<string, Peer> = new Map();
    private onPeerUpdate?: (peers: Peer[]) => void;
    private onMessage?: (message: Message) => void;
    private onFileTransfer?: (transfer: FileTransfer) => void;
    private localPeerId: string;
    private localPeerName: string;

    constructor(localPeerName: string) {
        this.localPeerId = this.generatePeerId();
        this.localPeerName = localPeerName;
    }

    private generatePeerId(): string {
        return `peer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    setOnPeerUpdate(callback: (peers: Peer[]) => void) {
        this.onPeerUpdate = callback;
    }

    setOnMessage(callback: (message: Message) => void) {
        this.onMessage = callback;
    }

    setOnFileTransfer(callback: (transfer: FileTransfer) => void) {
        this.onFileTransfer = callback;
    }

    async initLocalStream(video: boolean = true, audio: boolean = true): Promise<MediaStream> {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ video, audio });

            this.peers.forEach((peer) => {
                if (peer.connection && this.localStream) {
                    this.localStream.getTracks().forEach(track => {
                        const sender = peer.connection!.getSenders().find(s => s.track?.kind === track.kind);
                        if (sender) {
                            sender.replaceTrack(track).catch(err => {
                                console.error('Error replacing track:', err);
                            });
                        } else {
                            peer.connection!.addTrack(track, this.localStream!);
                        }
                    });
                }
            });

            return this.localStream;
        } catch (error) {
            console.error('Error accessing media devices:', error);
            throw error;
        }
    }

    getLocalStream(): MediaStream | null {
        return this.localStream;
    }

    getLocalPeerId(): string {
        return this.localPeerId;
    }

    getLocalPeerName(): string {
        return this.localPeerName;
    }

    async createPeerConnection(peerId: string, peerName: string): Promise<RTCPeerConnection> {
        const peerConnection = new RTCPeerConnection(ICE_SERVERS);

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream!);
            });
            console.log('Added local stream tracks to peer connection');
        }

        const dataChannel = peerConnection.createDataChannel('data');
        this.setupDataChannel(dataChannel, peerId, peerName);

        peerConnection.ontrack = (event) => {
            console.log('Received track from peer:', peerName, event.track.kind);
            const peer = this.peers.get(peerId);
            if (peer) {
                peer.stream = event.streams[0];
                this.notifyPeerUpdate();
            }
        };

        peerConnection.ondatachannel = (event) => {
            this.setupDataChannel(event.channel, peerId, peerName);
        };

        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state with ${peerName}:`, peerConnection.connectionState);
            if (peerConnection.connectionState === 'failed' ||
                peerConnection.connectionState === 'disconnected' ||
                peerConnection.connectionState === 'closed') {
                this.removePeer(peerId);
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE state with ${peerName}:`, peerConnection.iceConnectionState);
        };

        this.peers.set(peerId, {
            id: peerId,
            name: peerName,
            connection: peerConnection,
            dataChannel,
        });

        this.notifyPeerUpdate();
        return peerConnection;
    }

    private setupDataChannel(channel: RTCDataChannel, peerId: string, peerName: string) {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.dataChannel = channel;
        }

        channel.onopen = () => {
            console.log('Data channel opened with:', peerName);
        };

        channel.onclose = () => {
            console.log('Data channel closed with:', peerName);
        };

        channel.onerror = (error) => {
            console.error('Data channel error with:', peerName, error);
        };

        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'text') {
                    this.onMessage?.({
                        id: `msg-${Date.now()}-${Math.random()}`,
                        peerId,
                        peerName,
                        content: data.content,
                        timestamp: data.timestamp,
                        type: 'text',
                    });
                } else if (data.type === 'file-meta') {
                    this.onFileTransfer?.({
                        id: data.id,
                        name: data.name,
                        size: data.size,
                        progress: 0,
                        peerId,
                        peerName,
                    });
                }
            } catch (error) {
                console.error('Error parsing data channel message:', error);
            }
        };
    }

    sendMessage(content: string) {
        const message = {
            type: 'text',
            content,
            timestamp: Date.now(),
        };

        this.peers.forEach(peer => {
            if (peer.dataChannel?.readyState === 'open') {
                peer.dataChannel.send(JSON.stringify(message));
            }
        });

        this.onMessage?.({
            id: `msg-${Date.now()}-${Math.random()}`,
            peerId: this.localPeerId,
            peerName: this.localPeerName,
            content,
            timestamp: Date.now(),
            type: 'text',
        });
    }

    async sendFile(file: File) {
        const fileId = `file-${Date.now()}-${Math.random()}`;
        const fileMeta = {
            type: 'file-meta',
            id: fileId,
            name: file.name,
            size: file.size,
        };

        this.peers.forEach(peer => {
            if (peer.dataChannel?.readyState === 'open') {
                peer.dataChannel.send(JSON.stringify(fileMeta));
            }
        });
    }

    getPeers(): Peer[] {
        return Array.from(this.peers.values());
    }

    removePeer(peerId: string) {
        const peer = this.peers.get(peerId);
        if (peer) {
            console.log('Removing peer:', peer.name);
            peer.connection?.close();
            peer.dataChannel?.close();
            this.peers.delete(peerId);
            this.notifyPeerUpdate();
        }
    }

    private notifyPeerUpdate() {
        this.onPeerUpdate?.(this.getPeers());
    }

    toggleAudio(enabled: boolean) {
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = enabled;
            });
        }
    }

    toggleVideo(enabled: boolean) {
        if (this.localStream) {
            this.localStream.getVideoTracks().forEach(track => {
                track.enabled = enabled;
            });
        }
    }

    cleanup() {
        this.peers.forEach(peer => {
            peer.connection?.close();
            peer.dataChannel?.close();
        });
        this.peers.clear();

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }
}
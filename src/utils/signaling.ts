export interface SignalingMessage {
    type: 'offer' | 'answer' | 'ice-candidate' | 'peer-discovery' | 'peer-info';
    from: string;
    fromName: string;
    to?: string;
    data?: unknown;
}

export class LocalSignalingServer {
    private onSignal?: (message: SignalingMessage) => void;
    private peerId: string;
    private peerName: string;
    private isClosed = false;
    private pollInterval: NodeJS.Timeout | null = null;
    private lastMessageId = -1; // ✅ Start from -1
    private apiUrl: string;

    constructor(peerId: string, peerName: string) {
        this.peerId = peerId;
        this.peerName = peerName;
        this.apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        this.startPolling();
    }

    private startPolling() {
        this.pollInterval = setInterval(() => {
            this.pollMessages();
        }, 500);
    }

    private async pollMessages() {
        if (this.isClosed) return;
        try {
            const response = await fetch(
                `${this.apiUrl}/api/signaling?lastId=${this.lastMessageId}&peerId=${this.peerId}`
            );
            if (response.ok) {
                const messages: any[] = await response.json();
                messages.forEach((msg: any) => {
                    // ✅ Update lastMessageId from the message ID field
                    if (msg.id !== undefined) {
                        this.lastMessageId = Math.max(this.lastMessageId, msg.id);
                    }
                    // Pass the message to the handler
                    this.onSignal?.(msg);
                });
            }
        } catch (error) {
            console.error('Failed to poll messages:', error);
        }
    }

    setOnSignal(callback: (message: SignalingMessage) => void) {
        this.onSignal = callback;
    }

    send(message: Omit<SignalingMessage, 'from' | 'fromName'>) {
        if (this.isClosed) return;
        fetch(`${this.apiUrl}/api/signaling`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...message,
                from: this.peerId,
                fromName: this.peerName,
            }),
        }).catch(err => console.error('Failed to send signal:', err));
    }

    broadcast(type: SignalingMessage['type'], data?: unknown) {
        this.send({ type, data });
    }

    close() {
        this.isClosed = true;
        if (this.pollInterval) clearInterval(this.pollInterval);
    }
}
import { useState, useEffect } from 'react';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { HomePage } from './pages/HomePage';
import { MeetingRoom } from './pages/MeetingRoom';
import { UsersPage } from './pages/UsersPage';
import { FileServerPage } from './pages/FileServerPage';
import { SharedWithMePage } from './pages/SharedWithMePage';
import { MessagesPage } from './pages/MessagesPage';
import { Phone, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const AUTH_STORAGE_KEY = 'lan-collab-auth';

export interface Account {
    id: string;
    username: string;
    fullName: string;
}

interface IncomingCall {
    id: string;
    fromAccountId: string;
    fromName: string;
    roomId: string;
    createdAt: number;
}

interface Notification {
    id: string;
    type: 'message' | 'call' | 'global';
    from: string;
    message: string;
    timestamp: number;
}

type Page = 'login' | 'signup' | 'home' | 'meeting' | 'users' | 'fileserver' | 'sharedwithme' | 'messages';

function App() {
    const [currentPage, setCurrentPage] = useState<Page>('login');
    const [account, setAccount] = useState<Account | null>(null);
    const [roomId, setRoomId] = useState<string>('');
    const [selectedUser, setSelectedUser] = useState<Account | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
    const [notifications, setNotifications] = useState<Notification[]>([]);

    // Load saved auth on mount
    useEffect(() => {
        const loadAuth = async () => {
            try {
                const saved = localStorage.getItem(AUTH_STORAGE_KEY);
                if (saved) {
                    const acc: Account = JSON.parse(saved);
                    setAccount(acc);
                    setCurrentPage('home');
                    console.log('✅ Auto-login successful');
                }
            } catch (error) {
                console.error('Error loading auth:', error);
                localStorage.removeItem(AUTH_STORAGE_KEY);
            } finally {
                setIsLoading(false);
            }
        };

        loadAuth();
    }, []);

    // ✅ Poll for incoming calls
    useEffect(() => {
        if (!account) return;

        const checkCalls = async () => {
            try {
                const response = await fetch(`${API_URL}/api/calls?toAccountId=${account.id}`);
                if (response.ok) {
                    const calls = await response.json();
                    const ringingCalls = calls.filter((call: any) => call.status === 'ringing');

                    if (ringingCalls.length > 0 && currentPage !== 'meeting') {
                        const latestCall = ringingCalls[0];
                        setIncomingCall({
                            id: latestCall.id,
                            fromAccountId: latestCall.fromAccountId,
                            fromName: latestCall.fromName,
                            roomId: latestCall.roomId,
                            createdAt: latestCall.createdAt,
                        });
                    }
                }
            } catch (error) {
                console.error('Failed to check calls:', error);
            }
        };

        checkCalls();
        const interval = setInterval(checkCalls, 2000); // Poll every 2 seconds

        return () => clearInterval(interval);
    }, [account, currentPage]);

    const handleLogin = async (username: string, password: string) => {
        try {
            const response = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Login failed');
            }

            const data = await response.json();
            setAccount(data.account);
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.account));
            setCurrentPage('home');
            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Login failed' };
        }
    };

    const handleSignup = async (username: string, password: string, fullName: string) => {
        try {
            const response = await fetch(`${API_URL}/api/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, fullName }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Signup failed');
            }

            const data = await response.json();
            setAccount(data.account);
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.account));
            setCurrentPage('home');
            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Signup failed' };
        }
    };

    const handleLogout = () => {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        setAccount(null);
        setCurrentPage('login');
    };

    const handleJoinMeeting = (room: string) => {
        setRoomId(room);
        setCurrentPage('meeting');
    };

    const handleCallUser = async (targetAccountId: string, targetName: string) => {
        const callRoomId = `call-${account?.id}-${targetAccountId}-${Date.now()}`;

        const response = await fetch(`${API_URL}/api/calls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromAccountId: account?.id,
                toAccountId: targetAccountId,
                fromName: account?.fullName,
                toName: targetName,
                roomId: callRoomId,
            }),
        });

        if (response.ok) {
            const data = await response.json();
            if (data.call) {
                localStorage.setItem('activeCallId', data.call.id);
            }
        }

        handleJoinMeeting(callRoomId);
    };

    const handleMessageUser = (user: Account) => {
        setSelectedUser(user);
        setCurrentPage('messages');
    };

    // ✅ Handle accepting incoming call
    const handleAcceptCall = async () => {
        if (incomingCall) {
            await fetch(`${API_URL}/api/calls/${incomingCall.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'accepted' }),
            });

            handleJoinMeeting(incomingCall.roomId);
            setIncomingCall(null);
        }
    };

    // ✅ Handle rejecting incoming call
    const handleRejectCall = async () => {
        if (incomingCall) {
            await fetch(`${API_URL}/api/calls/${incomingCall.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'rejected' }),
            });
            setIncomingCall(null);
        }
    };

    const addNotification = (notification: Omit<Notification, 'id'>) => {
        const id = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newNotif: Notification = { ...notification, id };
        setNotifications(prev => [newNotif, ...prev]);

        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 10000);
    };

    const clearNotification = (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    if (currentPage === 'login') {
        return (
            <LoginPage
                onLogin={handleLogin}
                onSwitchToSignup={() => setCurrentPage('signup')}
            />
        );
    }

    if (currentPage === 'signup') {
        return (
            <SignupPage
                onSignup={handleSignup}
                onSwitchToLogin={() => setCurrentPage('login')}
            />
        );
    }

    if (currentPage === 'meeting' && account) {
        return (
            <MeetingRoom
                account={account}
                roomId={roomId}
                onLeave={() => setCurrentPage('home')}
            />
        );
    }

    if (currentPage === 'users' && account) {
        return (
            <UsersPage
                account={account}
                onBack={() => setCurrentPage('home')}
                onCallUser={handleCallUser}
                onMessageUser={handleMessageUser}
            />
        );
    }

    if (currentPage === 'fileserver' && account) {
        return (
            <FileServerPage
                account={account}
                onBack={() => setCurrentPage('home')}
            />
        );
    }

    if (currentPage === 'sharedwithme' && account) {
        return (
            <SharedWithMePage
                account={account}
                onBack={() => setCurrentPage('home')}
            />
        );
    }

    if (currentPage === 'messages' && account && selectedUser) {
        return (
            <MessagesPage
                account={account}
                targetUser={selectedUser}
                onBack={() => setCurrentPage('users')}
            />
        );
    }

    if (account) {
        return (
            <>
                <HomePage
                    account={account}
                    onLogout={handleLogout}
                    onJoinMeeting={handleJoinMeeting}
                    onViewUsers={() => setCurrentPage('users')}
                    onViewFileServer={() => setCurrentPage('fileserver')}
                    onViewSharedWithMe={() => setCurrentPage('sharedwithme')}
                    notifications={notifications}
                    onClearNotification={clearNotification}
                    onAddNotification={addNotification}
                />

                {/* ✅ Incoming Call Notification */}
                {incomingCall && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full animate-bounce">
                            <div className="text-center mb-6">
                                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                                    <Phone className="w-10 h-10 text-green-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                                    Incoming Call
                                </h2>
                                <p className="text-lg text-gray-600">
                                    {incomingCall.fromName} is calling you...
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={handleAcceptCall}
                                    className="flex-1 px-6 py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold flex items-center justify-center gap-2"
                                >
                                    <Phone className="w-5 h-5" />
                                    Accept
                                </button>
                                <button
                                    onClick={handleRejectCall}
                                    className="flex-1 px-6 py-4 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold flex items-center justify-center gap-2"
                                >
                                    <X className="w-5 h-5" />
                                    Decline
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    }

    return null;
}

export default App;
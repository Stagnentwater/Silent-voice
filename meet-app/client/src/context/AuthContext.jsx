import { createContext, useContext, useMemo, useState } from 'react';
import { createRoom, joinRoom, loginUser, registerUser } from '../auth/authApi.js';

const TOKEN_KEY = 'signmeet_token';
const USER_KEY = 'signmeet_user';
const ROOM_KEY = 'signmeet_room';

const AuthContext = createContext(null);

function readStoredUser() {
  const rawUser = localStorage.getItem(USER_KEY);
  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser);
  } catch {
    return null;
  }
}

function readStoredRoom() {
  const rawRoom = localStorage.getItem(ROOM_KEY);
  if (!rawRoom) {
    return null;
  }

  try {
    return JSON.parse(rawRoom);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => readStoredUser());
  const [currentRoom, setCurrentRoom] = useState(() => readStoredRoom());

  const isAuthenticated = Boolean(token && user?.id);

  const register = async ({ username, password }) => {
    return registerUser({ username, password });
  };

  const login = async ({ username, password }) => {
    const result = await loginUser({ username, password });

    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));

    setToken(result.token);
    setUser(result.user);

    return result;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROOM_KEY);
    setToken(null);
    setUser(null);
    setCurrentRoom(null);
  };

  const createRoomForUser = async () => {
    if (!token) {
      throw new Error('Unauthorized');
    }
    const room = await createRoom({ token });
    localStorage.setItem(ROOM_KEY, JSON.stringify(room));
    setCurrentRoom(room);
    return room;
  };

  const joinRoomForUser = async ({ roomCode }) => {
    if (!token) {
      throw new Error('Unauthorized');
    }
    const room = await joinRoom({ token, roomCode });
    localStorage.setItem(ROOM_KEY, JSON.stringify(room));
    setCurrentRoom(room);
    return room;
  };

  const clearCurrentRoom = () => {
    localStorage.removeItem(ROOM_KEY);
    setCurrentRoom(null);
  };

  const value = useMemo(
    () => ({
      token,
      user,
      currentRoom,
      isAuthenticated,
      register,
      login,
      logout,
      createRoom: createRoomForUser,
      joinRoom: joinRoomForUser,
      clearCurrentRoom
    }),
    [token, user, currentRoom, isAuthenticated]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

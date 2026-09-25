import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearToken, getToken, isTransientApiError, setToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState('');

  const restoreSession = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setBootError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setBootError('');
    try {
      const data = await api('/auth/me');
      setUser(data.user);
      setBootError('');
    } catch (err) {
      if (err?.status === 401) {
        clearToken();
        setUser(null);
        setBootError('');
      } else if (isTransientApiError(err)) {
        // Keep the token — server was likely still waking. Let the user retry.
        setBootError(err.message || 'Server is waking up. Tap retry in a moment.');
      } else {
        clearToken();
        setUser(null);
        setBootError('');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  async function login(email, password, { onRetry } = {}) {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email, password },
      onRetry,
    });
    setToken(data.token);
    setUser(data.user);
    setBootError('');
    return data.user;
  }

  function logout() {
    clearToken();
    setUser(null);
    setBootError('');
  }

  async function updateProfile(payload) {
    const data = await api('/auth/profile', {
      method: 'PATCH',
      body: payload,
    });
    setUser(data.user);
    return data.user;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        bootError,
        retrySession: restoreSession,
        login,
        logout,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function AuthPage() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isRegisterMode = mode === 'register';

  async function handleSubmit() {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (isRegisterMode) {
        await register({ username, password });
        setMessage('Registration successful. You can now sign in.');
        setMode('login');
        setPassword('');
      } else {
        await login({ username, password });
        navigate('/landing', { replace: true });
      }
    } catch (err) {
      setError(err.message || (isRegisterMode ? 'Registration failed' : 'Sign in failed'));
    } finally {
      setLoading(false);
    }
  }

  function handleSwitchMode(nextMode) {
    setMode(nextMode);
    setError('');
    setMessage('');
    setPassword('');
  }

  return (
    <main className="auth-shell">
      <section className="auth-visual" aria-hidden="true" />

      <section className="auth-form-wrap">
        <div className="auth-brand">SignMeet</div>
        <h1 className="auth-title">{isRegisterMode ? 'Create account' : 'Welcome back!'}</h1>

        <div className="auth-panel">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="username"
            disabled={loading}
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
            placeholder="password"
            disabled={loading}
          />

          <button type="button" className="auth-submit" onClick={handleSubmit} disabled={loading}>
            {isRegisterMode ? 'Register' : 'Sign in'}
          </button>

          <p className="auth-switch-row">
            {isRegisterMode ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              className="auth-switch"
              onClick={() => handleSwitchMode(isRegisterMode ? 'login' : 'register')}
              disabled={loading}
            >
              {isRegisterMode ? 'Sign in' : 'Register'}
            </button>
          </p>

          {message ? <p className="auth-message">{message}</p> : null}
          {error ? <p className="warning">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}

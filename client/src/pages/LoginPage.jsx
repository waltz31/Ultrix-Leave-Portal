import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { isTransientApiError, wakeApiServer } from '../api';
import { homePathForRole } from '../utils';
import { APP_VERSION } from '../version';
import LoginBackground from '../components/LoginBackground';
import LoginLogo from '../components/LoginLogo';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Start waking the Render API as soon as the login screen opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('Connecting to server…');
      await wakeApiServer();
      if (!cancelled) setStatus('');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    setStatus('Signing in…');
    try {
      const user = await login(email, password, {
        onRetry: ({ attempt, max }) => {
          setStatus(
            attempt <= 2
              ? 'Server is waking up — please wait…'
              : `Still connecting… (try ${attempt}/${max})`
          );
        },
      });
      navigate(homePathForRole(user.role), { replace: true });
    } catch (err) {
      setError(
        isTransientApiError(err)
          ? 'Server is still starting. Wait a few seconds and try again.'
          : err.message || 'Sign in failed'
      );
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <LoginBackground />

      <div className="login-content">
        <div className="login-card">
          <div className="login-brand">
            <LoginLogo />
          </div>

          <form className="login-form" onSubmit={onSubmit}>
            <div className="login-copy">
              <h1 className="login-title">Sign in</h1>
              <p className="login-sub">Work email and password</p>
            </div>
            <label>
              Work email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="you@company.com"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <label>
              Password
              <div className="login-password-row">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  disabled={busy}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            {error && <p className="form-error">{error}</p>}
            {status && !error ? <p className="login-status">{status}</p> : null}
            <button className="btn primary full" type="submit" disabled={busy}>
              {busy ? status || 'Signing in…' : 'Continue'}
            </button>
          </form>
        </div>

        <p className="login-version">v{APP_VERSION}</p>
      </div>
    </div>
  );
}

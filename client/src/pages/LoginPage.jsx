import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { homePathForRole } from '../utils';
import { APP_VERSION } from '../version';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setIntroDone(true);
      return undefined;
    }
    const fallback = window.setTimeout(() => setIntroDone(true), 6500);
    return () => window.clearTimeout(fallback);
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(email, password);
      navigate(homePathForRole(user.role), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`login-page${introDone ? ' login-ready' : ' login-intro'}`}>
      <div className="login-bg" aria-hidden="true">
        <img src="/assets/login-bg.png" alt="" />
      </div>

      <div className="login-content">
        <div className="login-brand">
          <img
            className={`login-logo${introDone ? ' login-logo-settled' : ' login-logo-intro'}`}
            src="/assets/yupnup.svg"
            alt="YupNup"
            width={380}
            height={140}
            onAnimationEnd={(e) => {
              if (e.animationName === 'login-logo-flip') setIntroDone(true);
            }}
          />
        </div>

        {introDone && (
          <>
            <div className="login-panel glass login-panel-reveal">
              <form className="login-form" onSubmit={onSubmit}>
                <h1 className="login-title">Sign in</h1>
                <p className="login-sub">Use your work email and password</p>
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
                <button className="btn primary full" type="submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </div>

            <footer className="login-footer login-panel-reveal">
              <span className="login-version">v{APP_VERSION}</span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

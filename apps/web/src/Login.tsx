import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck, Activity, ChartNoAxesCombined } from 'lucide-react';
import { api } from './api';
import type { User } from './types';
export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const input = { email: form.get('email'), password: form.get('password') };
      if (register) {
        await api('/auth/register', input, 'POST');
        setRegister(false);
        setNotice('Account created. Sign in to open your paper portfolio.');
      } else onLogin(await api<User>('/auth/login', input, 'POST'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="/">
          α{' '}
          <span>
            AlphaSutra<span className="brand-dot">.</span>
          </span>
        </a>
        <div>
          <BadgeLine />
          <h1>
            Research deeply.
            <br />
            Trade deliberately.
          </h1>
          <p>
            A workspace for Indian-market research, model evaluation, and disciplined paper
            portfolios.
          </p>
          <div className="auth-facts">
            <div>
              <ShieldCheck />
              <span>Risk before execution</span>
            </div>
            <div>
              <Activity />
              <span>Measured model performance</span>
            </div>
            <div>
              <ChartNoAxesCombined />
              <span>₹10,00,000 paper capital</span>
            </div>
          </div>
        </div>
        <small>Paper trading only. No guaranteed returns or accuracy.</small>
      </section>
      <main className="auth-form">
        <span className="eyebrow">YOUR RESEARCH WORKSPACE</span>
        <h2>{register ? 'Create your account' : 'Welcome back'}</h2>
        <p>
          {register
            ? 'Start with a private, simulated portfolio.'
            : 'Sign in to your research and portfolio.'}
        </p>
        <form onSubmit={submit}>
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required maxLength={254} />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete={register ? 'new-password' : 'current-password'}
              required
            />
          </label>
          <small>Use at least 12 characters.</small>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create paper account' : 'Open workspace'}
            <ArrowRight size={18} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setRegister(!register);
            setError('');
          }}
        >
          {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </main>
    </div>
  );
}
function BadgeLine() {
  return <span className="eyebrow light">INDIAN MARKETS / QUANTITATIVE RESEARCH</span>;
}

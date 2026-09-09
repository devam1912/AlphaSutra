import { useEffect, useState } from 'react';
import { api, rupees } from './api';
import { Login } from './Login';
import { Panel, Stat } from './components';
import type { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [cash, setCash] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<User>('/auth/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user)
      void api<{ available: number }>('/summary')
        .then((result) => setCash(result.available))
        .catch(() => setError('Portfolio data is unavailable. Please retry later.'));
  }, [user]);
  if (loading)
    return (
      <div className="boot" role="status">
        Opening AlphaSutra...
      </div>
    );
  if (!user) return <Login onLogin={setUser} />;
  return (
    <main className="auth-form">
      <span className="eyebrow">ALPHASUTRA / PAPER WORKSPACE</span>
      <h1>Your paper account</h1>
      <p>{user.email}</p>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <Panel title="Portfolio">
        <Stat
          label="Available paper funds"
          value={rupees(cash)}
          note="Simulated money. No real funds are transferred."
        />
      </Panel>
      <button
        className="secondary"
        onClick={async () => {
          try {
            await api('/auth/logout', {}, 'POST');
            setUser(null);
            setCash(null);
          } catch {
            setError('Unable to sign out. Please retry.');
          }
        }}
      >
        Sign out
      </button>
    </main>
  );
}

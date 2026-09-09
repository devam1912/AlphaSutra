import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  ChartNoAxesCombined,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  RefreshCw,
  Settings,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { api, ApiError, rupees, when } from './api';
import { Badge, Empty, ExternalLink, Panel, Table } from './components';
import { Login } from './Login';
import { Overview, RecommendationCard } from './Overview';
import { PaperTrading } from './PaperTrading';
import { Research } from './Research';
import type { DashboardData, User } from './types';
const navigation = [
  ['Overview', LayoutDashboard],
  ['Recommendations', ChartNoAxesCombined],
  ['Paper trading', Wallet],
  ['Research lab', FlaskConical],
  ['News intelligence', Newspaper],
  ['Trade journal', BookOpen],
  ['Risk center', ShieldCheck],
  ['Settings', Settings],
] as const;
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState('Overview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [updated, setUpdated] = useState('');
  const mutationKeys = useRef(new Map<string, string>());
  const loading = useRef(false);
  useEffect(() => {
    void api<User>('/auth/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const paths = [
        'positions',
        'orders',
        'ledger',
        'trades',
        'recommendations',
        'models',
        'jobs',
        'news',
        'audit',
        'instruments',
      ] as const;
      const [portfolio, providers, ...collections] = await Promise.all([
        api<DashboardData['portfolio']>('/summary'),
        api<DashboardData['providers']>('/providers'),
        ...paths.map((path) => api<{ items: unknown[] }>(`/${path}`)),
      ]);
      const items = Object.fromEntries(
        paths.map((path, i) => [path, (collections[i] as { items: unknown[] }).items]),
      );
      setData({ portfolio, providers, ...items } as DashboardData);
      setUpdated(new Date().toISOString());
      setError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        setData(null);
      } else setError(e instanceof Error ? e.message : 'Unable to refresh');
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    if (!user) return;
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [user, refresh]);
  async function action(path: string, body?: unknown, method = 'POST') {
    setBusy(true);
    setError('');
    setNotice('');
    const fingerprint = JSON.stringify({ path, body, method });
    let key = mutationKeys.current.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      mutationKeys.current.set(fingerprint, key);
    }
    try {
      const result = await api<{ status?: string; rejection?: string } | undefined>(
        path,
        body,
        method,
        key,
      );
      mutationKeys.current.delete(fingerprint);
      setNotice(
        result?.status === 'REJECTED'
          ? `Order rejected by risk policy: ${result.rejection}`
          : 'Saved. Your workspace is updated.',
      );
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (checking)
    return (
      <div className="boot" role="status">
        Opening AlphaSutra…
      </div>
    );
  if (!user) return <Login onLogin={setUser} />;
  const disabled = busy || user.role === 'viewer';
  const navigate = (next: string) => {
    setView(next);
    setMenu(false);
    setNotice('');
  };
  return (
    <div className="workspace">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <a className="brand" href="/">
          α{' '}
          <span>
            AlphaSutra<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map(([name, Icon]) => (
            <button
              key={name}
              aria-current={view === name ? 'page' : undefined}
              className={view === name ? 'active' : ''}
              onClick={() => navigate(name)}
            >
              <Icon size={19} />
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Badge tone="green">PAPER ENVIRONMENT</Badge>
          <p>
            Evidence first.
            <br />
            Risk always.
          </p>
          <span className="account-email">{user.email}</span>
          <button
            className="logout"
            onClick={async () => {
              try {
                await api('/auth/logout', {}, 'POST');
                setUser(null);
                setData(null);
              } catch {
                setError('Unable to sign out. Please retry.');
              }
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{view}</strong>
          </div>
          <div className="topbar-status">
            <span className="status-dot" />
            <span>Paper trading</span>
            <Badge>NSE / INDIA</Badge>
          </div>
        </header>
        <main id="content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">ALPHASUTRA INTELLIGENCE</span>
              <h1>{view === 'Overview' ? 'Portfolio overview' : view}</h1>
              <p>
                {view === 'Overview'
                  ? 'A clear view of your capital, opportunities, and risk.'
                  : 'Research, evaluate, and keep every decision accountable.'}
              </p>
            </div>
            <button className="secondary" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
          {updated && <small className="last-updated">Last refreshed {when(updated)} IST</small>}
          {error && (
            <div role="alert" className="error">
              {error} {data && 'Displayed records may be out of date.'}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          {!data ? (
            <Empty title={error ? 'Workspace unavailable' : 'Loading your workspace'}>
              Your account data will appear when the API is available.
            </Empty>
          ) : (
            <>
              {view === 'Overview' && <Overview data={data} navigate={navigate} />}
              {view === 'Recommendations' && (
                <Panel title="Opportunity research" aside={<Badge>NO GUARANTEED OUTCOMES</Badge>}>
                  {data.recommendations.length ? (
                    <div className="recommendation-grid">
                      {data.recommendations.map((item) => (
                        <RecommendationCard key={item._id} item={item} />
                      ))}
                    </div>
                  ) : (
                    <Empty title="No recommendations yet">
                      Evaluate an instrument in the research lab. Missing data or weak evidence can
                      produce a no-trade decision.
                    </Empty>
                  )}
                </Panel>
              )}
              {view === 'Paper trading' && (
                <PaperTrading data={data} action={action} busy={disabled} />
              )}
              {view === 'Research lab' && <Research data={data} action={action} busy={disabled} />}
              {view === 'News intelligence' && (
                <Panel
                  title="News & events"
                  aside={
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() => void action('/jobs', { kind: 'news' }, 'POST')}
                    >
                      Refresh news
                    </button>
                  }
                >
                  {data.news.length ? (
                    <div className="news-list">
                      {data.news.map((n) => (
                        <article key={n._id}>
                          <div>
                            <span className="eyebrow">{n.source}</span>
                            <small>{when(n.publishedAt)} IST</small>
                          </div>
                          <h3>
                            <ExternalLink href={n.url}>{n.title}</ExternalLink>
                          </h3>
                          <p>
                            {n.signal?.summary ??
                              'AI interpretation unavailable. Read the original source for context.'}
                          </p>
                          <Badge>{n.status}</Badge>
                          {n.signal?.risk_flags.map((flag) => (
                            <Badge key={flag}>{flag}</Badge>
                          ))}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty title="No news ingested">
                      Configure permitted news feeds to start collecting source-linked events.
                    </Empty>
                  )}
                </Panel>
              )}
              {view === 'Trade journal' && (
                <>
                  <Panel title="Closed trades">
                    <Table
                      headings={['Instrument', 'Net P&L', 'Charges', 'Exit reason', 'Closed · IST']}
                      rows={data.trades.map((t) => [
                        t.instrumentId,
                        <span className={t.pnl < 0 ? 'negative' : 'positive'}>
                          {rupees(t.pnl)}
                        </span>,
                        rupees(t.fees),
                        t.reason,
                        when(t.exitAt),
                      ])}
                    />
                  </Panel>
                  {data.trades.map((t) => (
                    <Panel
                      key={t._id}
                      title={`${t.instrumentId} · ${t.analysis.classification.replaceAll('_', ' ')}`}
                    >
                      <ul>
                        {t.analysis.facts.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </Panel>
                  ))}
                  <Panel title="Decision audit">
                    <Table
                      headings={['Time · IST', 'Action', 'Record']}
                      rows={data.audit.map((a) => [
                        when(a.createdAt),
                        a.action,
                        <code>{a.entityId.slice(0, 12)}</code>,
                      ])}
                    />
                  </Panel>
                </>
              )}
              {view === 'Risk center' && (
                <>
                  <Panel
                    title="Execution controls"
                    aside={
                      <Badge tone={data.portfolio.killed ? 'red' : 'green'}>
                        {data.portfolio.killed
                          ? 'KILL SWITCH ACTIVE'
                          : data.portfolio.paused
                            ? 'PAUSED'
                            : 'PAPER MONITORING'}
                      </Badge>
                    }
                  >
                    <p>
                      Pause and kill controls prevent new exposure. Protective exits continue when
                      executable quotes are available.
                    </p>
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() =>
                          void action(
                            '/risk/controls',
                            { paused: !data.portfolio.paused, killed: data.portfolio.killed },
                            'PUT',
                          )
                        }
                      >
                        {data.portfolio.paused ? 'Resume entries' : 'Pause entries'}
                      </button>
                      <button
                        className="danger"
                        disabled={disabled}
                        onClick={() =>
                          void action(
                            '/risk/controls',
                            { paused: true, killed: !data.portfolio.killed },
                            'PUT',
                          )
                        }
                      >
                        {data.portfolio.killed
                          ? 'Clear kill switch · stay paused'
                          : 'Activate kill switch'}
                      </button>
                    </div>
                  </Panel>
                  <Panel title="Portfolio policy">
                    <dl className="details">
                      <dt>Equity ceiling</dt>
                      <dd>₹7,00,000</dd>
                      <dt>F&O ceiling</dt>
                      <dd>₹3,00,000</dd>
                      <dt>Planned risk per trade</dt>
                      <dd>0.5% maximum</dd>
                      <dt>Daily loss limit</dt>
                      <dd>2%</dd>
                      <dt>Drawdown limit</dt>
                      <dd>10%</dd>
                      <dt>Maximum positions</dt>
                      <dd>10</dd>
                      <dt>Live broker execution</dt>
                      <dd>Disabled</dd>
                    </dl>
                  </Panel>
                </>
              )}
              {view === 'Settings' && (
                <>
                  <Panel title="Connected services">
                    <Table
                      headings={['Service', 'Availability']}
                      rows={[
                        [
                          `Market data · ${data.providers.market.name}`,
                          <Badge>
                            {data.providers.market.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
                          </Badge>,
                        ],
                        [
                          'Groq news interpretation',
                          data.providers.groq.configured ? 'Configured' : 'Not configured',
                        ],
                        [
                          'Gemini fallback',
                          data.providers.gemini.configured ? 'Configured' : 'Not configured',
                        ],
                        [
                          'Python quantitative service',
                          data.providers.training.configured
                            ? 'Credential configured'
                            : 'Not configured',
                        ],
                        [
                          'Automatic paper entries',
                          data.providers.autoPaper ? 'Enabled · approved models only' : 'Disabled',
                        ],
                      ]}
                    />
                    <p className="form-hint">
                      Service credentials are managed on the server. They are never returned to this
                      browser.
                    </p>
                  </Panel>
                  <Panel title="Account & operating mode">
                    <dl className="details">
                      <dt>Account</dt>
                      <dd>{user.email}</dd>
                      <dt>Role</dt>
                      <dd>{user.role}</dd>
                      <dt>Environment</dt>
                      <dd>Paper simulation</dd>
                      <dt>Market timezone</dt>
                      <dd>Asia/Kolkata</dd>
                    </dl>
                  </Panel>
                </>
              )}
            </>
          )}
          <footer>
            <Activity size={15} />
            <span>
              Research and paper simulation. Market losses are possible. No assured returns or
              accuracy.
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

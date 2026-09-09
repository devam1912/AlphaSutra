import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { Badge, Empty, Panel, Stat, Table } from './components';
import { percent, rupees, when } from './api';
import type { DashboardData, Recommendation } from './types';
export function RecommendationCard({ item }: { item: Recommendation }) {
  return (
    <article className="recommendation">
      <div className="recommendation-title">
        <div>
          <span className="eyebrow">{item.regime.replaceAll('_', ' ')}</span>
          <h3>{item.symbol}</h3>
        </div>
        <Badge tone={item.status === 'CANDIDATE' ? 'green' : ''}>
          {item.status.replaceAll('_', ' ')}
        </Badge>
      </div>
      <div className="signal-numbers">
        <div>
          <small>Model probability</small>
          <strong>{percent(item.probability)}</strong>
        </div>
        <div>
          <small>Suggested quantity</small>
          <strong>{item.quantity}</strong>
        </div>
      </div>
      <div className="bracket">
        <span>
          Entry<strong>{rupees(item.entry)}</strong>
        </span>
        <span>
          Stop<strong>{rupees(item.stop)}</strong>
        </span>
        <span>
          Target 1<strong>{rupees(item.target1)}</strong>
        </span>
        <span>
          Target 2<strong>{rupees(item.target2)}</strong>
        </span>
      </div>
      <ul>
        {item.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <small>
        Prediction: {item.label.replaceAll('_', ' ')}. Data: {when(item.dataAsOf)} IST.
      </small>
      <small>Valid until {when(item.validUntil)} IST. Execution requires fresh risk checks.</small>
    </article>
  );
}
export function Overview({
  data,
  navigate,
}: {
  data: DashboardData;
  navigate: (view: string) => void;
}) {
  const p = data.portfolio;
  const conviction = data.recommendations.find(
    (r) => r.highConviction && new Date(r.validUntil) > new Date(),
  );
  return (
    <>
      <div className="stats">
        <Stat
          label="Portfolio value"
          value={rupees(p.value)}
          note={p.dataStatus === 'CURRENT' ? 'Marked to available quotes' : 'Fresh quotes required'}
        />
        <Stat label="Available cash" value={rupees(p.available)} note="Unreserved paper funds" />
        <Stat label="Realized P&L" value={rupees(p.realizedPnl)} note="After simulated charges" />
        <Stat
          label="Portfolio drawdown"
          value={percent(p.drawdown)}
          note="From the recorded high"
        />
      </div>
      <div className="overview-grid">
        <Panel title="High conviction" aside={<Badge tone="green">RISK GATED</Badge>}>
          {conviction ? (
            <RecommendationCard item={conviction} />
          ) : (
            <div className="conviction-empty">
              <div className="shield">
                <ShieldCheck size={34} />
              </div>
              <span className="eyebrow">CAPITAL PRESERVATION IS A DECISION</span>
              <h2>No qualifying trade right now.</h2>
              <p>
                Opportunities need an approved model, current data, and available risk budget. Your
                cash can stay in cash.
              </p>
              <button className="secondary" onClick={() => navigate('Research lab')}>
                Open research lab <ArrowUpRight size={16} />
              </button>
            </div>
          )}
        </Panel>
        <Panel title="Capital allocation">
          <div className="capital-total">
            <small>Total deposited</small>
            <strong>{rupees(p.netDeposits)}</strong>
          </div>
          {[
            ['Equity', p.equity, 70000000],
            ['F&O', p.derivatives, 30000000],
          ].map(([name, value, cap]) => (
            <div className="allocation" key={String(name)}>
              <div>
                <span>{name}</span>
                <strong>{rupees(Number(value))}</strong>
              </div>
              <progress value={Number(value)} max={Number(cap)} />
              <small>Ceiling {rupees(Number(cap))}</small>
            </div>
          ))}
          <div className="allocation-note">
            <ShieldCheck size={18} />
            <span>Allocation ceilings are maximums. No minimum deployment.</span>
          </div>
        </Panel>
      </div>
      <Panel
        title="Open positions"
        aside={
          <button className="text-button" onClick={() => navigate('Paper trading')}>
            Manage positions →
          </button>
        }
      >
        <Table
          headings={['Instrument', 'Quantity', 'Cost basis', 'Stop', 'Target']}
          rows={data.positions.map((p) => [
            p.instrumentId,
            p.quantity,
            rupees(p.cost),
            rupees(p.stop),
            rupees(p.target1),
          ])}
          empty="No open positions"
        />
      </Panel>
      <Panel title="Recent research activity">
        {data.jobs.length ? (
          <Table
            headings={['Job', 'Status', 'Requested', 'Details']}
            rows={data.jobs
              .slice(0, 5)
              .map((j) => [j.kind, <Badge>{j.state}</Badge>, when(j.createdAt), j.error ?? '—'])}
          />
        ) : (
          <Empty title="Your research starts here">
            Import verified data, train a baseline, and inspect its validation report.
          </Empty>
        )}
      </Panel>
    </>
  );
}

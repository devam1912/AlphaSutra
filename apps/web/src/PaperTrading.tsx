import { useState, type FormEvent } from 'react';
import { Badge, Panel, Stat, Table } from './components';
import { rupees, toPaise, when } from './api';
import type { DashboardData } from './types';
export type Action = (path: string, body?: unknown, method?: string) => Promise<boolean>;
export function PaperTrading({
  data,
  action,
  busy,
}: {
  data: DashboardData;
  action: Action;
  busy: boolean;
}) {
  const [formError, setFormError] = useState('');
  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const amount =
        toPaise(String(form.get('amount'))) * (form.get('direction') === 'withdraw' ? -1 : 1);
      await action('/wallet/transfer', { amount }, 'POST');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Invalid amount');
    }
  }
  async function order(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const input = {
        instrumentId: String(form.get('instrument')),
        quantity: Number(form.get('quantity')),
        type: String(form.get('type')),
        maxPrice: toPaise(String(form.get('entry'))),
        stop: toPaise(String(form.get('stop'))),
        target1: toPaise(String(form.get('target1'))),
        target2: toPaise(String(form.get('target2'))),
        ...(form.get('trigger') ? { triggerPrice: toPaise(String(form.get('trigger'))) } : {}),
      };
      await action('/orders', input, 'POST');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Invalid order');
    }
  }
  return (
    <>
      {formError && (
        <div className="error" role="alert">
          {formError}
        </div>
      )}
      <div className="stats">
        <Stat label="Available cash" value={rupees(data.portfolio.available)} />
        <Stat label="Reserved for orders" value={rupees(data.portfolio.blocked)} />
        <Stat label="Realized P&L" value={rupees(data.portfolio.realizedPnl)} />
        <Stat label="Unrealized P&L" value={rupees(data.portfolio.unrealizedPnl)} />
      </div>
      <div className="two-col">
        <Panel title="Paper wallet">
          <p>Move simulated funds. This does not transfer real money.</p>
          <form onSubmit={transfer} className="form-grid">
            <label>
              Action
              <select name="direction">
                <option value="deposit">Add paper funds</option>
                <option value="withdraw">Withdraw paper funds</option>
              </select>
            </label>
            <label>
              Amount in rupees
              <input
                name="amount"
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,2})?"
                required
                maxLength={13}
              />
            </label>
            <button className="primary" disabled={busy}>
              Update wallet
            </button>
          </form>
        </Panel>
        <Panel title="Place a paper order">
          <form onSubmit={order} className="form-grid">
            <label>
              Instrument
              <select name="instrument" required defaultValue="">
                <option value="" disabled>
                  Select instrument
                </option>
                {data.instruments.map((i) => (
                  <option key={i._id} value={i._id}>
                    {i.symbol} · {i.kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Order type
              <select name="type">
                <option>LIMIT</option>
                <option>MARKET</option>
                <option>STOP</option>
                <option>STOP_LIMIT</option>
              </select>
            </label>
            <label>
              Quantity
              <input name="quantity" type="number" min="1" step="1" required />
            </label>
            {[
              ['entry', 'Maximum entry ₹'],
              ['stop', 'Stop loss ₹'],
              ['target1', 'Target 1 ₹'],
              ['target2', 'Target 2 ₹'],
              ['trigger', 'Entry trigger ₹ (stop orders)'],
            ].map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  name={name}
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,2})?"
                  required={name !== 'trigger'}
                  maxLength={13}
                />
              </label>
            ))}
            <p className="form-hint">
              The risk engine can reject any order. Entry prices must match the instrument tick
              size.
            </p>
            <button className="primary" disabled={busy || !data.instruments.length}>
              Submit paper order
            </button>
          </form>
        </Panel>
      </div>
      <Panel title="Open positions">
        <Table
          headings={['Instrument', 'Quantity', 'Cost basis', 'Stop', 'Target', 'Action']}
          rows={data.positions.map((p) => [
            p.instrumentId,
            p.quantity,
            rupees(p.cost),
            rupees(p.stop),
            rupees(p.target1),
            <button
              className="secondary small"
              disabled={busy}
              onClick={() => void action(`/positions/${p._id}/close`, {}, 'POST')}
            >
              Close position
            </button>,
          ])}
        />
      </Panel>
      <Panel title="Order activity">
        <Table
          headings={['Instrument', 'Type', 'Filled / ordered', 'Entry cap', 'Status', 'Action']}
          rows={data.orders.map((o) => [
            o.instrumentId,
            o.type,
            `${o.filled} / ${o.quantity}`,
            rupees(o.maxPrice),
            <>
              <Badge>{o.status}</Badge>
              {o.rejection && <small>{o.rejection}</small>}
            </>,
            ['OPEN', 'PARTIALLY_FILLED'].includes(o.status) ? (
              <button
                className="secondary small"
                disabled={busy}
                onClick={() => void action(`/orders/${o._id}/cancel`, {}, 'POST')}
              >
                Cancel
              </button>
            ) : (
              '—'
            ),
          ])}
        />
      </Panel>
      <Panel title="Wallet ledger">
        <Table
          headings={['Time · IST', 'Type', 'Amount', 'Cash balance']}
          rows={data.ledger.map((l) => [
            when(l.createdAt),
            l.kind,
            rupees(l.amount),
            rupees(l.balance),
          ])}
        />
      </Panel>
    </>
  );
}

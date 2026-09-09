import { useState } from 'react';
import { Badge, Empty, LineChart, Panel, Stat, Table } from './components';
import { percent, when } from './api';
import type { DashboardData } from './types';
import type { Action } from './PaperTrading';
export function Research({
  data,
  action,
  busy,
}: {
  data: DashboardData;
  action: Action;
  busy: boolean;
}) {
  const [instrument, setInstrument] = useState('');
  const [baseline, setBaseline] = useState('logistic');
  const [modelId, setModelId] = useState('');
  const selected = data.models.find((m) => m._id === modelId) ?? data.models[0];
  const report = selected?.report;
  return (
    <>
      <Panel title="Research controls" aside={<Badge>CHRONOLOGICAL VALIDATION</Badge>}>
        <div className="research-controls">
          <label>
            Instrument
            <select
              value={instrument}
              onChange={(e) => {
                setInstrument(e.target.value);
                setModelId('');
              }}
            >
              <option value="">Select instrument</option>
              {data.instruments.map((i) => (
                <option key={i._id} value={i._id}>
                  {i.symbol}
                </option>
              ))}
            </select>
          </label>
          <label>
            Baseline
            <select value={baseline} onChange={(e) => setBaseline(e.target.value)}>
              <option value="logistic">Logistic regression</option>
              <option value="boosting">Gradient boosting</option>
            </select>
          </label>
          <label>
            Model
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">Select model</option>
              {data.models
                .filter((m) => !instrument || m.instrumentId === instrument)
                .map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.instrumentId} · {m.status} · {when(m.createdAt)}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="button-row">
          <button
            className="secondary"
            disabled={busy || !instrument}
            onClick={() =>
              void action('/jobs', { kind: 'history', instrumentId: instrument }, 'POST')
            }
          >
            Fetch raw history
          </button>
          <button
            className="primary"
            disabled={busy || !instrument}
            onClick={() =>
              void action('/jobs', { kind: 'train', instrumentId: instrument, baseline }, 'POST')
            }
          >
            Train challenger
          </button>
          <button
            className="secondary"
            disabled={busy || !instrument || !modelId}
            onClick={() =>
              void action('/jobs', { kind: 'score', instrumentId: instrument, modelId }, 'POST')
            }
          >
            Evaluate setup
          </button>
        </div>
        <p className="form-hint">
          Training needs adjusted candles and a verified exchange calendar. Raw history alone is not
          eligible. Models are never automatically approved after training.
        </p>
      </Panel>
      {report ? (
        <>
          <div className="stats">
            <Stat
              label="Selected-signal precision"
              value={percent(report.final.precision)}
              note={`${report.final.selected} selected signals`}
            />
            <Stat
              label="Coverage"
              value={percent(report.final.coverage)}
              note={`${report.final.samples} held-out samples`}
            />
            <Stat
              label="Brier score"
              value={report.final.brier.toFixed(3)}
              note="Lower is better"
            />
            <Stat
              label="Directional accuracy"
              value={percent(report.final.directional_accuracy)}
              note="Separate from trading profitability"
            />
          </div>
          <div className="two-col">
            <Panel title="Probability calibration">
              <svg
                viewBox="0 0 320 220"
                className="chart"
                role="img"
                aria-label="Calibration plot of estimated versus observed probability"
              >
                <path d="M30 190L290 20" stroke="#9daeb5" strokeDasharray="4 4" />
                {report.final.calibration.map((bin, i) => (
                  <circle
                    key={i}
                    cx={30 + bin.predicted * 260}
                    cy={190 - bin.observed * 170}
                    r={5}
                    fill="#007f73"
                  >
                    <title>
                      {percent(bin.predicted)} predicted; {percent(bin.observed)} observed;{' '}
                      {bin.count} samples
                    </title>
                  </circle>
                ))}
                <text x="90" y="214" fontSize="12">
                  Predicted probability →
                </text>
              </svg>
              <p className="form-hint">
                Dots near the diagonal indicate closer agreement between probability estimates and
                observed outcomes.
              </p>
            </Panel>
            <Panel title="Model record">
              <dl className="details">
                <dt>Status</dt>
                <dd>
                  <Badge>{selected.status}</Badge>
                </dd>
                <dt>Instrument</dt>
                <dd>{selected.instrumentId}</dd>
                <dt>Baseline</dt>
                <dd>{report.kind}</dd>
                <dt>Prediction definition</dt>
                <dd>{report.label.replaceAll('_', ' ')}</dd>
                <dt>Trained</dt>
                <dd>{when(selected.createdAt)} IST</dd>
              </dl>
              <details>
                <summary>Full validation report</summary>
                <pre>{JSON.stringify(report, null, 2)}</pre>
              </details>
            </Panel>
          </div>
          {report.backtest && (
            <Panel title="Held-out backtest">
              <div className="stats compact">
                <Stat label="Net return" value={percent(report.backtest.return)} />
                <Stat label="Max drawdown" value={percent(report.backtest.max_drawdown)} />
                <Stat label="Sharpe" value={report.backtest.sharpe?.toFixed(2) ?? 'Not measured'} />
                <Stat label="Trade win rate" value={percent(report.backtest.win_rate)} />
              </div>
              <LineChart
                values={report.backtest.equity_curve}
                label="Simulated equity curve after costs"
              />
              <p>
                {report.backtest.benchmark_scope}. Historical simulation is not a promise of future
                results.
              </p>
            </Panel>
          )}
        </>
      ) : (
        <Panel title="Model evaluation">
          <Empty title="No trained models yet">
            Your first completed training job will produce a calibration report and a separate
            chronological test result. No accuracy figures are pre-filled.
          </Empty>
        </Panel>
      )}
      <Panel title="Job history">
        <Table
          headings={['Requested · IST', 'Job', 'State', 'Details']}
          rows={data.jobs.map((j) => [
            when(j.createdAt),
            j.kind,
            <Badge>{j.state}</Badge>,
            j.error ?? '—',
          ])}
        />
      </Panel>
    </>
  );
}

import type { ReactNode } from 'react';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <ShieldCheck size={30} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Panel({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function Table({
  headings,
  rows,
  empty = 'No records yet',
}: {
  headings: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  if (!rows.length)
    return (
      <Empty title={empty}>New activity will appear here as you use your paper portfolio.</Empty>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function LineChart({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <Empty title="Not enough observations" />;
  const min = Math.min(...values),
    range = Math.max(...values) - min || 1;
  const points = values
    .map((v, i) => `${20 + (i / (values.length - 1)) * 660},${165 - ((v - min) / range) * 140}`)
    .join(' ');
  return (
    <svg className="chart" viewBox="0 0 700 190" role="img" aria-label={label}>
      <path d="M20 25H680 M20 95H680 M20 165H680" stroke="#dfe6e8" fill="none" />
      <polyline points={points} fill="none" stroke="#007f73" strokeWidth="2.5" />
    </svg>
  );
}
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={14} />
    </a>
  );
}

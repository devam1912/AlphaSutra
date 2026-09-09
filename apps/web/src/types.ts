export interface User {
  email: string;
  role: 'owner' | 'viewer';
}
export interface Portfolio {
  cash: number;
  available: number;
  blocked: number;
  value: number | null;
  equity: number;
  derivatives: number;
  realizedPnl: number;
  unrealizedPnl: number | null;
  netDeposits: number;
  drawdown: number | null;
  paused: boolean;
  killed: boolean;
  dataStatus: string;
}
export interface Position {
  _id: string;
  instrumentId: string;
  quantity: number;
  cost: number;
  stop: number;
  target1: number;
}
export interface Order {
  _id: string;
  instrumentId: string;
  type: string;
  quantity: number;
  filled: number;
  status: string;
  maxPrice: number;
  rejection?: string;
}
export interface Ledger {
  _id: string;
  kind: string;
  amount: number;
  balance: number;
  createdAt: string;
}
export interface Trade {
  _id: string;
  instrumentId: string;
  quantity: number;
  pnl: number;
  fees: number;
  reason: string;
  exitAt: string;
  analysis: { facts: string[]; classification: string };
}
export interface Recommendation {
  _id: string;
  symbol: string;
  status: string;
  probability: number | null;
  label: string;
  reasons: string[];
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  quantity: number;
  regime: string;
  dataAsOf: string;
  validUntil: string;
  highConviction: boolean;
}
export interface Instrument {
  _id: string;
  symbol: string;
  kind: string;
  sector: string;
}
export interface Job {
  _id: string;
  kind: string;
  state: string;
  error?: string;
  createdAt: string;
}
export interface Metrics {
  directional_accuracy: number;
  brier: number;
  precision: number | null;
  coverage: number;
  selected: number;
  samples: number;
  calibration: { predicted: number; observed: number; count: number }[];
}
export interface Model {
  _id: string;
  instrumentId: string;
  status: string;
  createdAt: string;
  report: {
    final: Metrics;
    label: string;
    kind: string;
    backtest?: {
      return: number;
      max_drawdown: number;
      sharpe: number | null;
      win_rate: number | null;
      equity_curve: number[];
      benchmark_scope: string;
    };
  };
}
export interface Article {
  _id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  status: string;
  signal: { summary: string; sentiment: number; risk_flags: string[] } | null;
}
export interface Audit {
  _id: string;
  action: string;
  createdAt: string;
  entityId: string;
}
export interface Providers {
  market: { name: string; configured: boolean };
  groq: { configured: boolean };
  gemini: { configured: boolean };
  training: { configured: boolean };
  autoPaper: boolean;
  liveTrading: boolean;
}
export interface DashboardData {
  portfolio: Portfolio;
  positions: Position[];
  orders: Order[];
  ledger: Ledger[];
  trades: Trade[];
  recommendations: Recommendation[];
  models: Model[];
  jobs: Job[];
  news: Article[];
  audit: Audit[];
  instruments: Instrument[];
  providers: Providers;
}

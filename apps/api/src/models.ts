export interface User {
  _id: string;
  email: string;
  passwordHash: string;
  role: 'owner' | 'viewer';
  createdAt: Date;
}

export interface Session {
  _id: string;
  userId: string;
  expiresAt: Date;
}

export interface Portfolio {
  _id: string;
  userId: string;
  cash: number;
  blocked: number;
  equity: number;
  derivatives: number;
  realizedPnl: number;
  netDeposits: number;
  peakValue: number;
  dailyStartValue: number;
  day: string;
  paused: boolean;
  killed: boolean;
  version: number;
  createdAt: Date;
}

export interface LedgerEntry {
  _id: string;
  userId: string;
  portfolioId: string;
  key: string;
  kind: 'INITIAL' | 'DEPOSIT' | 'WITHDRAWAL' | 'BUY' | 'SELL' | 'RESET';
  amount: number;
  balance: number;
  createdAt: Date;
}

export interface Audit {
  _id: string;
  userId: string;
  action: string;
  entityId: string;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface Idempotency {
  _id: string;
  userId: string;
  key: string;
  operation: string;
  fingerprint: string;
  result: Record<string, unknown>;
  createdAt: Date;
}

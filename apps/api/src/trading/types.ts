export interface Instrument {
  _id: string;
  symbol: string;
  exchange: 'NSE' | 'BSE';
  kind: 'EQUITY' | 'CALL' | 'PUT' | 'FUTURE';
  sector: string;
  correlationGroup: string;
  lotSize: number;
  tickSize: number;
  active: boolean;
  expiry?: string;
  strike?: number;
  underlying?: string;
  providerKey: string;
}
export interface Quote {
  _id: string;
  bid: number;
  ask: number;
  last: number;
  availableQuantity: number;
  asOf: Date;
  source: string;
  quality: 'verified' | 'development';
}
export interface MarketSession {
  _id: string;
  open: Date;
  close: Date;
  source: string;
}
export interface OrderInput {
  instrumentId: string;
  quantity: number;
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  maxPrice: number;
  triggerPrice?: number;
  stop: number;
  target1: number;
  target2: number;
}
export interface Order extends OrderInput {
  _id: string;
  userId: string;
  status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  filled: number;
  reserved: number;
  triggered: boolean;
  createdAt: Date;
  expiresAt: Date;
  lastQuoteAt?: Date;
  rejection?: string;
  feeVersion: string;
}
export interface Position {
  _id: string;
  userId: string;
  instrumentId: string;
  orderId: string;
  quantity: number;
  cost: number;
  entryFees: number;
  stop: number;
  target1: number;
  target2: number;
  openedAt: Date;
  updatedAt: Date;
  maxPrice: number;
  minPrice: number;
}
export interface Trade {
  _id: string;
  userId: string;
  positionId: string;
  instrumentId: string;
  quantity: number;
  cost: number;
  proceeds: number;
  fees: number;
  pnl: number;
  entryAt: Date;
  exitAt: Date;
  exitPrice: number;
  reason: string;
  analysis: { classification: string; facts: string[]; trainingEligible: boolean };
}
export interface FeeSchedule {
  version: string;
  brokerageBps: number;
  brokerageCap: number;
  exchangeBps: number;
  sttBuyBps: number;
  sttSellBps: number;
  stampBuyBps: number;
  sebiBps: number;
  gstBps: number;
  slippageBps: number;
}

export type JobKind = 'history' | 'train' | 'score' | 'news';
export interface ResearchJob {
  _id: string;
  userId: string;
  kind: JobKind;
  instrumentId?: string;
  modelId?: string;
  baseline: 'logistic' | 'boosting';
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
  resultId?: string;
}
export interface ModelRecord {
  _id: string;
  userId: string;
  instrumentId: string;
  jobId: string;
  status: 'CHALLENGER' | 'CHAMPION';
  report: Record<string, unknown>;
  createdAt: Date;
}
export interface Recommendation {
  _id: string;
  userId: string;
  instrumentId: string;
  symbol: string;
  modelId: string;
  status: 'CANDIDATE' | 'NO_TRADE' | 'DATA_UNAVAILABLE' | 'RESEARCH_ONLY';
  probability: number | null;
  label: string;
  reasons: string[];
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  quantity: number;
  regime: string;
  features: Record<string, number>;
  createdAt: Date;
  validUntil: Date;
  dataAsOf: Date;
  day: string;
  highConviction: boolean;
}

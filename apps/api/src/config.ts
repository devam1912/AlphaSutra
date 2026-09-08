import { z } from 'zod';

const boolean = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGO_URL: z.string().default('mongodb://127.0.0.1:27017/alphasutra?replicaSet=rs0'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  LIVE_TRADING_ENABLED: boolean.default('false'),
  REGISTRATION_ENABLED: boolean.default('true'),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = schema.parse(env);
  if (config.LIVE_TRADING_ENABLED) {
    throw new Error('Live trading has no approved broker adapter and cannot be enabled');
  }
  if (config.NODE_ENV === 'production' && !config.APP_ORIGIN.startsWith('https://')) {
    throw new Error('Production requires an HTTPS application origin');
  }
  return config;
}

export type Config = ReturnType<typeof readConfig>;

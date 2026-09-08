import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import { Database } from '../apps/api/src/db.js';

const app = createApp(
  new Database('mongodb://127.0.0.1:27017/test'),
  readConfig({ NODE_ENV: 'test' }),
);
describe('HTTP boundary', () => {
  it('serves liveness without claiming database readiness', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('paper');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  it('rejects anonymous tenant access', async () => {
    expect((await request(app).get('/api/v1/portfolio')).status).toBe(401);
  });
  it('rejects cross-origin mutations before touching the database', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_ORIGIN');
  });
  it('validates auth payloads without echoing passwords', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'bad', password: 'secret' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

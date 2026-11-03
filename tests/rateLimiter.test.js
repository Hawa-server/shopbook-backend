// The in-memory rate limiter: allows `max` hits per key per window, then
// refuses with 429 RATE_LIMITED and Retry-After; keys are counted separately;
// a new window starts fresh.

const express = require('express');
const request = require('supertest');
const { createRateLimiter } = require('../src/lib/rateLimiter');
const { errorHandler } = require('../src/middleware/errorHandler');
const { createLogger } = require('../src/lib/logger');

describe('createRateLimiter', () => {
  let time;
  let limiter;

  beforeEach(() => {
    time = 1_000_000;
    limiter = createRateLimiter({ name: 'test', windowMs: 15 * 60 * 1000, max: 3, now: () => time });
  });
  afterEach(() => limiter.stop());

  test('allows max hits, then refuses until the window ends', () => {
    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(true);
    expect(limiter.consume('a').allowed).toBe(true);
    const fourth = limiter.consume('a');
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBe(15 * 60);

    time += 15 * 60 * 1000; // the window has ended
    expect(limiter.consume('a').allowed).toBe(true);
  });

  test('each key has its own count', () => {
    for (let i = 0; i < 3; i += 1) limiter.consume('a');
    expect(limiter.consume('a').allowed).toBe(false);
    expect(limiter.consume('b').allowed).toBe(true);
  });

  test('as middleware it answers 429 RATE_LIMITED with Retry-After', async () => {
    const app = express();
    app.get('/limited', limiter.middleware(() => 'same-key'), (req, res) => res.json({ ok: true }));
    app.use(errorHandler({ logger: createLogger({ level: 'silent' }) }));

    for (let i = 0; i < 3; i += 1) expect((await request(app).get('/limited')).status).toBe(200);
    const res = await request(app).get('/limited');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBe(String(15 * 60));
  });

  test('a request with no key is not counted', async () => {
    const app = express();
    app.get('/unkeyed', limiter.middleware(() => undefined), (req, res) => res.json({ ok: true }));
    for (let i = 0; i < 5; i += 1) expect((await request(app).get('/unkeyed')).status).toBe(200);
  });
});

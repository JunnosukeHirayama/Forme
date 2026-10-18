import { test } from 'node:test';
import assert from 'node:assert/strict';
import { origin, limitedBytes, clientAddress, HttpError } from '../src/lib/http';
import { verifyTurnstile } from '../src/lib/turnstile';
test('CSRF validation uses the canonical origin and rejects missing, malformed and forged origins', () => {
  const old = process.env.SITE_URL;
  process.env.SITE_URL = 'https://forms.example.com';
  try {
    assert.doesNotThrow(() =>
      origin(
        new Request('https://internal.example/api/forms', {
          headers: { Origin: 'https://forms.example.com' },
        }),
      ),
    );
    for (const value of [
      'https://attacker.example',
      'null',
      'not-a-url',
      'https://forms.example.com.evil.example',
    ])
      assert.throws(
        () =>
          origin(
            new Request('https://forms.example.com/api/forms', { headers: { Origin: value } }),
          ),
        HttpError,
      );
    assert.throws(() => origin(new Request('https://forms.example.com/api/forms')), HttpError);
  } finally {
    if (old === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = old;
  }
});
test('streaming body limit applies even without a declared Content-Length', async () => {
  const request = new Request('https://example.com', { method: 'POST', body: 'x'.repeat(256001) });
  await assert.rejects(limitedBytes(request, 256000), /大きすぎ/);
});
test('client supplied forwarded headers are never used as a trusted rate limit address', () => {
  const old = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    assert.equal(
      clientAddress(
        new Request('https://example.com', {
          headers: { 'cf-connecting-ip': 'fake', 'x-forwarded-for': 'fake' },
        }),
      ),
      'unknown',
    );
    assert.equal(
      clientAddress(
        new Request('https://example.com', {
          headers: { 'x-vercel-forwarded-for': '192.0.2.10', 'x-forwarded-for': 'fake' },
        }),
      ),
      '192.0.2.10',
    );
  } finally {
    if (old === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = old;
  }
});
test('Turnstile fails closed in production and checks both hostname and action on the server', async () => {
  const original = {
    mode: process.env.NODE_ENV,
    key: process.env.TURNSTILE_SECRET_KEY,
    url: process.env.SITE_URL,
  };
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { NODE_ENV: 'production', SITE_URL: 'https://forms.example.com' });
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    await assert.rejects(verifyTurnstile('token', 'submit-form'), /設定/);
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    await assert.rejects(verifyTurnstile(undefined, 'submit-form'), /チェック/);
    for (const result of [
      { success: false },
      { success: true, hostname: 'attacker.example', action: 'submit-form' },
      { success: true, hostname: 'forms.example.com', action: 'login' },
    ]) {
      globalThis.fetch = async () => Response.json(result);
      await assert.rejects(verifyTurnstile('token', 'submit-form'), /確認/);
    }
    globalThis.fetch = async () =>
      Response.json({ success: true, hostname: 'forms.example.com', action: 'submit-form' });
    await assert.doesNotReject(verifyTurnstile('valid', 'submit-form'));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      NODE_ENV: original.mode,
      TURNSTILE_SECRET_KEY: original.key,
      SITE_URL: original.url,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

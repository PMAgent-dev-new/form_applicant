import assert from 'node:assert/strict';
import test from 'node:test';

const project = { name: 'test-project', url: 'https://example.test' };

async function loadGuard(healthToken, cacheKey) {
  const previous = process.env.HEALTH_CHECK_TOKEN;
  if (healthToken) process.env.HEALTH_CHECK_TOKEN = healthToken;
  else delete process.env.HEALTH_CHECK_TOKEN;
  try {
    return await import(`./post-deploy-guard.mjs?test=${cacheKey}`);
  } finally {
    if (previous === undefined) delete process.env.HEALTH_CHECK_TOKEN;
    else process.env.HEALTH_CHECK_TOKEN = previous;
  }
}

test('health token送信時のstatus=okは2回確認後にunhealthyとする', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: 'ok' });
  try {
    const { healthCheck } = await loadGuard('configured-token', 'token-rejected');
    const result = await healthCheck(project, { retryDelayMs: 0 });
    assert.equal(result.verdict, 'unhealthy');
    assert.match(result.detail, /readiness token was not accepted/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('health token未設定時だけstatus=okをlivenessとして許容する', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: 'ok' });
  try {
    const { healthCheck } = await loadGuard('', 'liveness-only');
    const result = await healthCheck(project, { retryDelayMs: 0 });
    assert.equal(result.verdict, 'live');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

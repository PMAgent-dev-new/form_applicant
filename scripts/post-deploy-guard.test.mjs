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

test('healthCheck helperはtoken未設定時だけstatus=okをlivenessとして返す', async () => {
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

test('guard本体の前提条件はhealth token欠落を拒否する', async () => {
  const { guardPrerequisiteError } = await loadGuard('', 'missing-health-token');
  assert.match(
    guardPrerequisiteError({ vercelToken: 'configured', healthToken: '' }),
    /HEALTH_CHECK_TOKEN is required/,
  );
});

test('commit statusが失敗なら旧productionがREADYでもdeploy gateを通さない', async () => {
  const { deploymentGate } = await loadGuard('', 'deploy-failed');
  const result = deploymentGate(
    'failure',
    { state: 'READY', target: 'production', meta: { githubCommitSha: 'new-sha' } },
    'new-sha',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /commit status is failure/);
});

test('productionのSHAがpush対象と違えばdeploy gateを通さない', async () => {
  const { deploymentGate } = await loadGuard('', 'deploy-old-sha');
  const result = deploymentGate(
    'success',
    { state: 'READY', target: 'production', meta: { githubCommitSha: 'old-sha' } },
    'new-sha',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /latest production SHA is old-sha/);
});

test('commit status・production target・READY・SHAが揃った場合だけdeploy gateを通す', async () => {
  const { deploymentGate } = await loadGuard('', 'deploy-ready');
  const result = deploymentGate(
    'success',
    { state: 'READY', target: 'production', meta: { githubCommitSha: 'new-sha' } },
    'new-sha',
  );
  assert.equal(result.ok, true);
});

test('latest deploymentがREADYでも本番aliasが旧deploymentならgateを通さない', async () => {
  const { productionAliasGate } = await loadGuard('', 'alias-old');
  const result = productionAliasGate(
    { readyState: 'READY', url: 'old-deploy.vercel.app' },
    { state: 'READY', target: 'production', url: 'new-deploy.vercel.app' },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /points to old-deploy/);
});

test('本番aliasとlatest production deploymentが一致すればalias gateを通す', async () => {
  const { productionAliasGate } = await loadGuard('', 'alias-current');
  const result = productionAliasGate(
    { readyState: 'READY', url: 'https://new-deploy.vercel.app' },
    { state: 'READY', target: 'production', url: 'new-deploy.vercel.app' },
  );
  assert.equal(result.ok, true);
});

test('rollback先は現在以外のREADY production deploymentに固定する', async () => {
  const { selectRollbackTarget } = await loadGuard('', 'rollback-target');
  const target = selectRollbackTarget(
    [
      { url: 'failed.vercel.app', state: 'ERROR', target: 'production' },
      { url: 'preview.vercel.app', state: 'READY', target: 'preview' },
      { url: 'known-good.vercel.app', state: 'READY', target: 'production' },
    ],
    'current.vercel.app',
  );
  assert.equal(target?.url, 'known-good.vercel.app');
});

test('deep:true のreadyだけを合格にする', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: 'ready', deep: true });
  try {
    const { healthCheck } = await loadGuard('configured-token', 'deep-true');
    const result = await healthCheck(project, { retryDelayMs: 0 });
    assert.equal(result.verdict, 'ready');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('deepを省いたreadyは2回目でunhealthyとする（envの有無しか見ていない応答）', async () => {
  const originalFetch = globalThis.fetch;
  // ?deep=0 を足された場合と、deepフィールドの無い旧ビルドの両方を同じ扱いにする。
  for (const body of [{ status: 'ready', deep: false }, { status: 'ready' }]) {
    globalThis.fetch = async () => Response.json(body);
    try {
      const { healthCheck } = await loadGuard('configured-token', `shallow-${JSON.stringify(body)}`);
      const result = await healthCheck(project, { retryDelayMs: 0 });
      assert.equal(result.verdict, 'unhealthy');
      assert.match(result.detail, /deep check missing or skipped/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test('Lark資格情報だけのdegradedはalert-only（rollbackしない）', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ status: 'degraded', unreachable: ['lark_auth_ridejob:lark_code_10003'] }, { status: 503 });
  try {
    const { healthCheck } = await loadGuard('configured-token', 'lark-only');
    const result = await healthCheck(project, { retryDelayMs: 0 });
    // envはデプロイ時のスナップショットなので、コードを戻しても資格情報は直らない。
    assert.equal(result.verdict, 'alert-only');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Lark以外が混ざるdegradedは従来どおりunhealthy（rollback対象）', async () => {
  const originalFetch = globalThis.fetch;
  for (const body of [
    { status: 'degraded', missing: ['openai_ads_relay_upstream'] },
    { status: 'degraded', unreachable: ['lark_auth_ridejob:bad_domain', 'relay_upstream'] },
  ]) {
    globalThis.fetch = async () => Response.json(body, { status: 503 });
    try {
      const { healthCheck } = await loadGuard('configured-token', `mixed-${JSON.stringify(body)}`);
      const result = await healthCheck(project, { retryDelayMs: 0 });
      assert.equal(result.verdict, 'unhealthy');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

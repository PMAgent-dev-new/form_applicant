#!/usr/bin/env node
/**
 * Post-deploy guard.
 *
 * Runs on push to main (after auto-merge). Waits for the two Vercel production
 * deployments to settle, health-checks each production URL via /api/health, and
 * — only when explicitly armed — rolls back any project that is unhealthy.
 *
 * Safety posture:
 * - Defaults to DRY-RUN. Without ROLLBACK_ARMED=true it never touches production;
 *   it only reports what it WOULD roll back and fails the job so the alert is visible.
 * - Readiness is only asserted when HEALTH_CHECK_TOKEN is available (in both the
 *   Vercel prod env and here). Until then it falls back to a liveness check and warns.
 * - The production URL is the source of truth, not the deploy status: a failed Vercel
 *   build leaves the previous good deployment live, which the health check will pass.
 *
 * Rollback requires VERCEL_TOKEN. Health/monitoring need only GITHUB_TOKEN.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  GITHUB_REPOSITORY,
  GITHUB_SHA,
  GITHUB_TOKEN,
  VERCEL_TOKEN = '',
  HEALTH_CHECK_TOKEN = '',
  VERCEL_TEAM = 'pmagent-dev-new',
  LARK_ALERT_WEBHOOK = '',
  ROLLBACK_ARMED = 'false',
  GUARD_MODE = 'guard',
  FORCE_UNHEALTHY = 'false',
} = process.env;

const ARMED = ROLLBACK_ARMED.trim().toLowerCase() === 'true';
const MODE = GUARD_MODE.trim().toLowerCase(); // 'guard' | 'selftest'
const DRILL = FORCE_UNHEALTHY.trim().toLowerCase() === 'true';

// project name -> production URL (custom domain / production alias, NOT the
// immutable *.vercel.app deployment URL, which can be behind Deployment Protection).
const PROJECTS = [
  { name: 'ridejob-entry', url: 'https://ridejob.pmagent.jp' },
  { name: 'ridejob-form', url: 'https://ridejob.jp/entry' },
];

const HEALTH_ATTEMPTS = 6;
const HEALTH_INTERVAL_MS = 10_000;
const DEPLOY_WAIT_MS = 12 * 60_000;
const DEPLOY_POLL_MS = 15_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const warn = (...a) => console.log(`::warning::${a.join(' ')}`);
const fail = (...a) => console.log(`::error::${a.join(' ')}`);

async function ghJson(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'post-deploy-guard',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} -> ${res.status}`);
  return res.json();
}

function vercelStatusFor(statuses, projectName) {
  // Production commit status context looks like "Vercel – ridejob-entry".
  return statuses.find(
    (s) => /^vercel\b/i.test(s.context) && s.context.includes(projectName),
  );
}

// Wait until each project's Vercel commit status is terminal (success/failure/error),
// so the health check tests a settled state rather than a mid-build one.
async function waitForDeploys() {
  const deadline = Date.now() + DEPLOY_WAIT_MS;
  for (;;) {
    let statuses = [];
    try {
      const data = await ghJson(
        `/repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/status`,
      );
      statuses = data.statuses || [];
    } catch (e) {
      warn(`could not read commit statuses: ${e.message}`);
    }

    const settled = PROJECTS.map((p) => {
      const s = vercelStatusFor(statuses, p.name);
      return { name: p.name, state: s?.state ?? 'missing' };
    });
    log(`deploy states: ${settled.map((s) => `${s.name}=${s.state}`).join(', ')}`);

    const allTerminal = settled.every(
      (s) => s.state === 'success' || s.state === 'failure' || s.state === 'error',
    );
    if (allTerminal) return settled;
    if (Date.now() > deadline) {
      warn('timed out waiting for Vercel deploy statuses; checking prod anyway');
      return settled;
    }
    await sleep(DEPLOY_POLL_MS);
  }
}

/**
 * @returns {Promise<{project:string, verdict:'ready'|'live'|'unhealthy', detail:string}>}
 */
async function healthCheck(project) {
  const headers = HEALTH_CHECK_TOKEN ? { 'x-health-token': HEALTH_CHECK_TOKEN } : {};
  let degraded = 0;
  let lastDetail = 'no response';

  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${project.url}/api/health`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.json().catch(() => ({}));
      lastDetail = `HTTP ${res.status} ${JSON.stringify(body)}`;

      if (res.status === 200 && body.status === 'ready') {
        return { project: project.name, verdict: 'ready', detail: lastDetail };
      }
      if (res.status === 200 && body.status === 'ok') {
        // Liveness only: readiness not asserted (token not effective in prod yet).
        return { project: project.name, verdict: 'live', detail: lastDetail };
      }
      if (res.status === 503 && body.status === 'degraded') {
        degraded += 1;
        if (degraded >= 2) {
          return { project: project.name, verdict: 'unhealthy', detail: lastDetail };
        }
      }
    } catch (e) {
      lastDetail = `error: ${e.message}`;
    }
    log(`  ${project.name} attempt ${attempt}/${HEALTH_ATTEMPTS}: ${lastDetail}`);
    if (attempt < HEALTH_ATTEMPTS) await sleep(HEALTH_INTERVAL_MS);
  }
  return { project: project.name, verdict: 'unhealthy', detail: lastDetail };
}

function linkArgs(project) {
  const dir = mkdtempSync(join(tmpdir(), `vlink-${project.name}-`));
  const base = ['--token', VERCEL_TOKEN, '--scope', VERCEL_TEAM, '--cwd', dir, '--yes'];
  execFileSync('npx', ['--yes', 'vercel@latest', 'link', '--project', project.name, ...base], {
    stdio: 'inherit',
  });
  return base;
}

function rollback(project) {
  // vercel rollback (no target) rolls the linked project back to its previous
  // production deployment. Link in a throwaway dir so we target the right project.
  const base = linkArgs(project);
  execFileSync('npx', ['--yes', 'vercel@latest', 'rollback', ...base], { stdio: 'inherit' });
}

// selftest: prove the rollback PREREQUISITES (Vercel auth + team scope + project
// resolution/link) work in CI, WITHOUT performing a rollback. This de-risks arming
// the guard without touching production.
function selfTest() {
  if (!VERCEL_TOKEN) {
    fail('selftest: VERCEL_TOKEN is not set');
    process.exitCode = 1;
    return;
  }
  let ok = true;
  for (const project of PROJECTS) {
    try {
      log(`\n=== selftest: ${project.name} ===`);
      const base = linkArgs(project); // link proves token + scope + project name resolve
      execFileSync('npx', ['--yes', 'vercel@latest', 'ls', ...base], { stdio: 'inherit' });
      log(`✓ ${project.name}: vercel auth + link + ls OK (rollback prerequisites verified)`);
    } catch (e) {
      ok = false;
      fail(`${project.name}: selftest FAILED — ${e.message}`);
    }
  }
  if (!ok) process.exitCode = 1;
  else log('\nselftest passed: rollback can authenticate and resolve both projects');
}

async function notify(text) {
  if (!LARK_ALERT_WEBHOOK) return;
  try {
    await fetch(LARK_ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    });
  } catch (e) {
    warn(`Lark notify failed: ${e.message}`);
  }
}

async function main() {
  if (!GITHUB_REPOSITORY || !GITHUB_SHA || !GITHUB_TOKEN) {
    fail('missing GITHUB_REPOSITORY / GITHUB_SHA / GITHUB_TOKEN');
    process.exitCode = 1;
    return;
  }

  log(
    `post-deploy guard: mode=${MODE} armed=${ARMED} drill=${DRILL} ` +
      `readinessToken=${HEALTH_CHECK_TOKEN ? 'set' : 'absent'} ` +
      `vercelToken=${VERCEL_TOKEN ? 'set' : 'absent'} sha=${GITHUB_SHA.slice(0, 7)}`,
  );

  if (MODE === 'selftest') {
    selfTest();
    return;
  }

  await waitForDeploys();

  const results = [];
  for (const project of PROJECTS) {
    log(`health-checking ${project.name} (${project.url}/api/health)`);
    const r = await healthCheck(project);
    if (DRILL) {
      // Fire-drill: force the rollback path to exercise it on demand.
      results.push({ ...r, verdict: 'unhealthy', detail: `[FORCED DRILL] ${r.detail}` });
    } else {
      results.push(r);
    }
  }

  for (const r of results) {
    if (r.verdict === 'ready') log(`✓ ${r.project}: ready — ${r.detail}`);
    else if (r.verdict === 'live') warn(`${r.project}: liveness only (readiness not verified) — ${r.detail}`);
    else fail(`${r.project}: UNHEALTHY — ${r.detail}`);
  }

  const unhealthy = results.filter((r) => r.verdict === 'unhealthy');
  if (unhealthy.length === 0) {
    log('all production projects healthy');
    return;
  }

  for (const r of unhealthy) {
    const line = `post-deploy guard: ${r.project} unhealthy after deploy ${GITHUB_SHA.slice(0, 7)} — ${r.detail}`;
    if (ARMED && VERCEL_TOKEN) {
      fail(`${line} → rolling back`);
      await notify(`🔴 ${line}\nRolling back ${r.project} to previous production deployment.`);
      try {
        rollback(PROJECTS.find((p) => p.name === r.project));
        await notify(`↩️ ${r.project}: rollback requested (previous production deployment).`);
      } catch (e) {
        fail(`rollback of ${r.project} failed: ${e.message}`);
        await notify(`⚠️ ${r.project}: rollback FAILED — ${e.message}. Manual intervention needed.`);
      }
    } else {
      const why = !VERCEL_TOKEN ? 'no VERCEL_TOKEN' : 'dry-run (not armed)';
      warn(`${line} → WOULD roll back, but ${why}`);
      await notify(`🟡 [dry-run] ${line}\nWould roll back ${r.project}, but ${why}.`);
    }
  }

  process.exitCode = 1; // surface the unhealthy deploy regardless of arm state
}

main().catch((e) => {
  fail(`post-deploy guard crashed: ${e.stack || e.message}`);
  process.exitCode = 1;
});

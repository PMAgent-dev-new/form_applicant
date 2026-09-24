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
 * - Rollback is considered only after both the GitHub commit status and the latest
 *   Vercel production deployment prove that the pushed SHA is live. A failed build
 *   must not be mistaken for a healthy deploy just because the previous alias is live.
 *
 * Rollback requires VERCEL_TOKEN. Health/monitoring need only GITHUB_TOKEN.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
//
// ⚠️ この対応づけは「どのプロジェクトを rollback するか」を決めるので、取り違えると
// 健全な方を巻き戻す。実測での根拠:
//   - ridejob-entry は basePath=/entry でビルドされており（/entry/api/health が 200、
//     ルートの /api/health は 404）、Cloudflare Worker 経由で ridejob.jp/entry を出す。
//     カスタムドメインが無いため og:image に ridejob-entry.vercel.app が出ていた。
//   - ridejob.pmagent.jp 側は og:image が自ドメインで解決される＝カスタムドメイン保有。
//     これが ridejob-form。
// ⚠️ POST_DEPLOY_ROLLBACK_ARMED は 2026-07-13 から既に "true" で、VERCEL_TOKEN もある。
// つまり取り違えたまま1か月、main への push ごとに「健全な方を巻き戻す」経路が生きていた。
// ヘルスチェックURLは2本とも200を返すので緑のままで、誰も気づけない形の事故だった。
const PROJECTS = [
  { name: 'ridejob-form', url: 'https://ridejob.pmagent.jp', alias: 'ridejob.pmagent.jp' },
  { name: 'ridejob-entry', url: 'https://ridejob.jp/entry', alias: 'ridejob-entry.vercel.app' },
];

const HEALTH_ATTEMPTS = 6;
const HEALTH_INTERVAL_MS = 10_000;
const DEPLOY_WAIT_MS = 12 * 60_000;
const DEPLOY_POLL_MS = 15_000;
const VERCEL_CLI = 'vercel@59.17.0';

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
 * Fail closed unless the pushed SHA is both successfully built and the latest
 * READY production deployment for the project.
 *
 * @param {string} commitState
 * @param {{state?:string,target?:string,meta?:{githubCommitSha?:string}} | undefined} deployment
 * @param {string} expectedSha
 * @returns {{ok:boolean,reason:string}}
 */
export function deploymentGate(commitState, deployment, expectedSha) {
  if (commitState !== 'success') {
    return { ok: false, reason: `commit status is ${commitState}` };
  }
  if (!deployment) return { ok: false, reason: 'production deployment is missing' };
  if (deployment.target !== 'production' || deployment.state !== 'READY') {
    return {
      ok: false,
      reason: `latest deployment is target=${deployment.target ?? 'unknown'} state=${deployment.state ?? 'unknown'}`,
    };
  }
  const deployedSha = deployment.meta?.githubCommitSha ?? '';
  if (deployedSha !== expectedSha) {
    return {
      ok: false,
      reason: `latest production SHA is ${deployedSha ? deployedSha.slice(0, 7) : 'missing'}`,
    };
  }
  return { ok: true, reason: `production SHA ${deployedSha.slice(0, 7)} is READY` };
}

function deploymentHost(value = '') {
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** rollback後に最新deploymentだけ作られ、実ドメインaliasが旧版のまま残る事故を防ぐ。 */
export function productionAliasGate(alias, deployment) {
  if (!alias) return { ok: false, reason: 'production alias is missing' };
  if (alias.readyState !== 'READY') {
    return { ok: false, reason: `production alias is ${alias.readyState ?? 'unknown'}` };
  }
  const aliasTarget = deploymentHost(alias.url);
  const deploymentTarget = deploymentHost(deployment?.url);
  if (!aliasTarget || aliasTarget !== deploymentTarget) {
    return {
      ok: false,
      reason: `production alias points to ${aliasTarget || 'missing'}, expected ${deploymentTarget || 'missing'}`,
    };
  }
  return { ok: true, reason: `production alias points to ${aliasTarget}` };
}

async function waitForProductionAlias(project, deployment, options = {}) {
  const attempts = options.attempts ?? 6;
  const retryDelayMs = options.retryDelayMs ?? 10_000;
  let last = { ok: false, reason: 'production alias was not checked' };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = productionAliasGate(inspectedAlias(project), deployment);
    } catch (e) {
      last = { ok: false, reason: `could not inspect production alias — ${e.message}` };
    }
    if (last.ok) return last;
    log(`  ${project.name} alias attempt ${attempt}/${attempts}: ${last.reason}`);
    if (attempt < attempts) await sleep(retryDelayMs);
  }
  return last;
}

export function guardPrerequisiteError({ vercelToken, healthToken }) {
  if (!vercelToken) return 'VERCEL_TOKEN is required to verify the production deployment SHA';
  if (!healthToken) return 'HEALTH_CHECK_TOKEN is required for authenticated readiness checks';
  return '';
}

export function selectRollbackTarget(deployments, currentUrl) {
  return deployments.find(
    (deployment) =>
      deployment.url !== currentUrl &&
      deployment.target === 'production' &&
      deployment.state === 'READY',
  );
}

/**
 * @param {{name:string,url:string}} project
 * @param {{retryDelayMs?:number}} [options]
 * @returns {Promise<{project:string, verdict:'ready'|'live'|'alert-only'|'unhealthy', detail:string}>}
 */
export async function healthCheck(project, options = {}) {
  const headers = HEALTH_CHECK_TOKEN ? { 'x-health-token': HEALTH_CHECK_TOKEN } : {};
  let degraded = 0;
  let shallowReady = 0;
  let rejectedReadiness = 0;
  let lastDetail = 'no response';

  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${project.url}/api/health`, {
        headers,
        // health の maxDuration より長く待つ。短いと、health がまだ答えを作っている間に切って
        // 応答なしと数え、健全なデプロイまで rollback してしまう。
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => ({}));
      lastDetail = `HTTP ${res.status} ${JSON.stringify(body)}`;

      if (res.status === 200 && body.status === 'ready') {
        if (body.deep === true) {
          return { project: project.name, verdict: 'ready', detail: lastDetail };
        }
        // deep を省いた ready は「env が在る」ところまでしか見ていない。2026-09-17〜24 の
        // 障害は、まさにその状態で 7 日間 ready を返し続けた。alias 切替の最中に旧ビルドが
        // 応答することがあるので 1 回だけ許容し、続くなら合格にしない。
        shallowReady += 1;
        if (shallowReady >= 2) {
          return {
            project: project.name,
            verdict: 'unhealthy',
            detail: `${lastDetail} (deep check missing or skipped)`,
          };
        }
      }
      if (res.status === 200 && body.status === 'ok') {
        if (!HEALTH_CHECK_TOKEN) {
          // Secret未設定の移行期間だけはlivenessへフォールバックする。
          return { project: project.name, verdict: 'live', detail: lastDetail };
        }
        // Secretを送ったのにokなら、Vercel側の未反映または不一致。1回はalias切替中を許容する。
        rejectedReadiness += 1;
        if (rejectedReadiness >= 2) {
          return {
            project: project.name,
            verdict: 'unhealthy',
            detail: `${lastDetail} (readiness token was not accepted)`,
          };
        }
      }
      if (res.status === 503 && body.status === 'degraded') {
        degraded += 1;
        // Lark の資格情報だけが原因の degraded は、**コードを戻しても直らない**。
        // Vercel の env はデプロイ時のスナップショットなので、rollback は「壊れた env を
        // 持つ前のデプロイ」へ戻すだけで、env を直すための再デプロイを巻き戻してしまう。
        // 外部サービスの一時的な不調で本番が勝手に戻ることも防ぐ。知らせるに留める。
        // missing が一緒に来たら rollback 対象のまま。**このデプロイで新しく必須になった
        // env なら**、戻せば要求ごと消えて直る（例: 必須の env を入れ忘れたままマージした）。
        // ただし前のデプロイも同じ env を要求していれば、戻しても直らず recovery が失敗し、
        // 本番は1つ前のビルドに留まる（再前進の処理は無い）。2026-09-24 時点の本番がこれで、
        // SUBMISSION_VAULT_* が未設定のまま複数デプロイ済み。**VERCEL_TOKEN を直す前に
        // SUBMISSION_VAULT_* を入れること**（逆順だと最初のデプロイで本番が巻き戻る）。
        // 表が読めない（mismatched の lark_base_）も Lark 側の設定なので同じ扱いにする。
        // 列の不足（lark_columns_）は missing と同じく rollback 対象のまま。**このデプロイで
        // 新しく書くようになった列なら**、戻せば要求ごと消えて直る。
        const larkSide = [
          ...(Array.isArray(body.unreachable) ? body.unreachable : []),
          ...(Array.isArray(body.mismatched) ? body.mismatched : []),
        ].map(String);
        const larkOnly =
          larkSide.length > 0 &&
          larkSide.every((u) => u.startsWith('lark_auth_') || u.startsWith('lark_base_')) &&
          !(Array.isArray(body.missing) && body.missing.length > 0);
        if (degraded >= 2) {
          return {
            project: project.name,
            verdict: larkOnly ? 'alert-only' : 'unhealthy',
            detail: lastDetail,
          };
        }
      }
    } catch (e) {
      lastDetail = `error: ${e.message}`;
    }
    log(`  ${project.name} attempt ${attempt}/${HEALTH_ATTEMPTS}: ${lastDetail}`);
    if (attempt < HEALTH_ATTEMPTS) await sleep(options.retryDelayMs ?? HEALTH_INTERVAL_MS);
  }
  return { project: project.name, verdict: 'unhealthy', detail: lastDetail };
}

function vercelExec(args, options = {}) {
  return execFileSync('npx', ['--yes', VERCEL_CLI, ...args], {
    env: { ...process.env, VERCEL_TOKEN },
    ...options,
  });
}

function productionDeployments(project) {
  const output = vercelExec(
    [
      'ls',
      project.name,
      '--scope',
      VERCEL_TEAM,
      '--environment',
      'production',
      '--format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(output);
  return parsed.deployments ?? [];
}

function inspectedAlias(project) {
  const output = vercelExec(
    ['inspect', project.alias, '--scope', VERCEL_TEAM, '--format', 'json'],
    { encoding: 'utf8' },
  );
  return JSON.parse(output);
}

function linkArgs(project) {
  const dir = mkdtempSync(join(tmpdir(), `vlink-${project.name}-`));
  const base = ['--scope', VERCEL_TEAM, '--cwd', dir, '--yes'];
  vercelExec(['link', '--project', project.name, ...base], {
    stdio: 'inherit',
  });
  return base;
}

function rollback(project, deploymentUrl) {
  // 対象URLを固定し、確認後に別deployが出ても「その時点のprevious」を誤って戻さない。
  const base = linkArgs(project);
  vercelExec(['rollback', `https://${deploymentUrl}`, ...base], { stdio: 'inherit' });
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
      vercelExec(['ls', ...base], { stdio: 'inherit' });
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

  const prerequisiteError = guardPrerequisiteError({
    vercelToken: VERCEL_TOKEN,
    healthToken: HEALTH_CHECK_TOKEN,
  });
  if (prerequisiteError) {
    fail(prerequisiteError);
    process.exitCode = 1;
    return;
  }

  const deployStates = await waitForDeploys();

  // A failed/missing deploy leaves the old production alias healthy. Do not let
  // that old response turn this run green, and never roll it back for a build
  // that did not reach production.
  const deployGateFailures = [];
  const deployContexts = new Map();
  for (const project of PROJECTS) {
    const commitState = deployStates.find((s) => s.name === project.name)?.state ?? 'missing';
    try {
      const deployments = productionDeployments(project);
      const current = deployments[0];
      const gate = deploymentGate(commitState, current, GITHUB_SHA);
      const aliasGate = gate.ok
        ? await waitForProductionAlias(project, current)
        : { ok: false, reason: 'deployment gate failed' };
      const rollbackTarget = selectRollbackTarget(deployments.slice(1), current?.url);
      if (!gate.ok) deployGateFailures.push(`${project.name}: ${gate.reason}`);
      else if (!aliasGate.ok) deployGateFailures.push(`${project.name}: ${aliasGate.reason}`);
      else if (ARMED && !rollbackTarget) {
        deployGateFailures.push(`${project.name}: no READY production rollback target found`);
      } else {
        log(`✓ ${project.name}: ${gate.reason}; ${aliasGate.reason}`);
        deployContexts.set(project.name, { current, rollbackTarget });
      }
    } catch (e) {
      deployGateFailures.push(`${project.name}: could not verify production SHA — ${e.message}`);
    }
  }

  if (deployGateFailures.length > 0) {
    for (const line of deployGateFailures) fail(line);
    await notify(
      `🔴 post-deploy guard: deployment verification failed for ${GITHUB_SHA.slice(0, 7)}\n` +
        deployGateFailures.join('\n') +
        '\nNo rollback was attempted because the pushed SHA was not proven live.',
    );
    process.exitCode = 1;
    return;
  }

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
    else if (r.verdict === 'alert-only') fail(`${r.project}: DEGRADED (Lark auth) — ${r.detail}`);
    else fail(`${r.project}: UNHEALTHY — ${r.detail}`);
  }

  // rollback しない degraded。先に知らせてから unhealthy の処理へ進む。
  const alertOnly = results.filter((r) => r.verdict === 'alert-only');
  for (const r of alertOnly) {
    const line = `post-deploy guard: ${r.project} degraded (Lark auth) after deploy ${GITHUB_SHA.slice(0, 7)} — ${r.detail}`;
    fail(`${line} → NOT rolling back (code rollback cannot fix credentials)`);
    await notify(
      `🔴 ${line}\n` +
        'rollback はしません。env はデプロイ時のスナップショットなので、前のデプロイへ戻しても ' +
        '同じ壊れた資格情報を持つだけです。LARK_DOMAIN_* / APP_ID_* / APP_SECRET_* を直して ' +
        '再デプロイしてください（Vercel は再デプロイするまで env が効きません）。',
    );
  }

  const unhealthy = results.filter((r) => r.verdict === 'unhealthy');
  if (unhealthy.length === 0) {
    if (alertOnly.length > 0) {
      process.exitCode = 1; // rollback はしないが、赤くして人が見る状態にする
      return;
    }
    log('all production projects healthy');
    return;
  }

  for (const r of unhealthy) {
    const line = `post-deploy guard: ${r.project} unhealthy after deploy ${GITHUB_SHA.slice(0, 7)} — ${r.detail}`;
    if (ARMED && VERCEL_TOKEN) {
      fail(`${line} → rolling back`);
      await notify(`🔴 ${line}\nRolling back ${r.project} to previous production deployment.`);
      try {
        const project = PROJECTS.find((p) => p.name === r.project);
        const context = deployContexts.get(r.project);
        if (!project || !context?.rollbackTarget) {
          throw new Error('verified rollback target is missing');
        }

        // Gate後に別のproduction deployが出た競合ではrollbackしない。
        const latestBeforeRollback = productionDeployments(project)[0];
        const stillCurrent = deploymentGate('success', latestBeforeRollback, GITHUB_SHA);
        const aliasStillCurrent = productionAliasGate(inspectedAlias(project), latestBeforeRollback);
        if (
          !stillCurrent.ok ||
          !aliasStillCurrent.ok ||
          latestBeforeRollback?.url !== context.current.url
        ) {
          throw new Error('production changed after verification; rollback aborted');
        }

        rollback(project, context.rollbackTarget.url);
        const alias = inspectedAlias(project);
        if (alias.url !== context.rollbackTarget.url || alias.readyState !== 'READY') {
          throw new Error(
            `rollback alias mismatch — expected ${context.rollbackTarget.url}, got ${alias.url ?? 'missing'}`,
          );
        }
        const recovery = await healthCheck(project);
        if (recovery.verdict !== 'ready') {
          throw new Error(`rollback completed but readiness was not restored — ${recovery.detail}`);
        }
        log(`✓ ${r.project}: rollback restored readiness — ${recovery.detail}`);
        await notify(`↩️ ${r.project}: rollback completed and readiness was verified.`);
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

const executedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === executedUrl) {
  main().catch((e) => {
    fail(`post-deploy guard crashed: ${e.stack || e.message}`);
    process.exitCode = 1;
  });
}

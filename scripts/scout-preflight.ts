// 承認済みの単発確認専用。通常buildには接続せず、メール・候補者APIを呼ばない。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeRequest, parseClaudeResponse } from "../src/lib/scout/ai";
import { loadJob } from "../src/lib/scout/sources";
import {
  hasJobdbConfig,
  JobdbHttpError,
  listLatestPublishedJobIds,
} from "../src/lib/jobdb";
import { jobsReadSource } from "../src/lib/jobs-source";

export async function runPreflight(args: string[]) {
  const [permission, month, startText, deadlineText] = args;
  const start = Number(startText),
    deadline = Date.parse(deadlineText);
  const currentMonth = () =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
    }).format(new Date()) + "-01";
  const model = process.env.SCOUT_CLAUDE_MODEL;
  if (
    permission !== "--approved-three-public-jobs" ||
    month !== currentMonth() ||
    !Number.isInteger(start) ||
    start < 0 ||
    start + 3 > 100 ||
    !Number.isFinite(deadline) ||
    deadline < Date.now() ||
    deadline > Date.now() + 3600000 ||
    process.env.SCOUT_ENABLED !== "false" ||
    process.env.SCOUT_SEND_ENABLED !== "false" ||
    process.env.SCOUT_AI_ENABLED !== "false" ||
    model !== "claude-sonnet-5-5" ||
    process.env.SCOUT_AI_MONTHLY_LIMIT !== "100"
  )
    throw new Error("preflight_gate");
  const key = process.env.SCOUT_CLAUDE_API_KEY;
  const vault = process.env.SUBMISSION_VAULT_URL?.replace(/\/+$/, "");
  const serviceKey = process.env.SUBMISSION_VAULT_SERVICE_KEY;
  const domain = process.env.MICROCMS_SERVICE_DOMAIN;
  const cmsKey = process.env.MICROCMS_API_KEY;
  // 求人の読み先（JOBS_READ_SOURCE）の接続設定だけを求める
  const readsJobdb = jobsReadSource() === "jobdb";
  if (
    !key ||
    !serviceKey ||
    vault !== "https://tdlnowmdanapxmgebaqu.supabase.co" ||
    (readsJobdb
      ? !hasJobdbConfig()
      : !domain || !/^[a-zA-Z0-9-]+$/.test(domain) || !cmsKey)
  )
    throw new Error("connection_configuration");
  const claudeHeaders = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  const available = await fetch(
    `https://api.anthropic.com/v1/models/${model}`,
    {
      headers: claudeHeaders,
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!available.ok) throw new Error(`claude_model_http_${available.status}`);
  const modelData = await available.json();
  if (modelData.id !== model) throw new Error("claude_model_mismatch");
  console.log(
    "SCOUT_PREFLIGHT " + JSON.stringify({ keyAuthenticated: true, model }),
  );
  let listing: { contents?: Array<{ id: string; publishedAt: string }> };
  if (readsJobdb) {
    try {
      listing = { contents: await listLatestPublishedJobIds(3) };
    } catch (error) {
      if (error instanceof JobdbHttpError)
        throw new Error(`public_jobs_http_${error.status}`);
      throw new Error("public_jobs_fetch");
    }
  } else {
    const jobsResponse = await fetch(
      `https://${domain}.microcms.io/api/v1/jobs?limit=3&fields=id,publishedAt&orders=-publishedAt`,
      {
        headers: { "X-MICROCMS-API-KEY": cmsKey! },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!jobsResponse.ok)
      throw new Error(`public_jobs_http_${jobsResponse.status}`);
    listing = await jobsResponse.json();
  }
  const ids = listing.contents?.map(
    (j: { id: string; publishedAt: string }) => j.publishedAt && j.id,
  );
  if (
    !Array.isArray(ids) ||
    ids.length !== 3 ||
    new Set(ids).size !== 3 ||
    ids.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id),
    )
  )
    throw new Error("public_job_ids");
  const checkWindow = () => {
    if (Date.now() >= deadline) throw new Error("preflight_expired");
    if (month !== currentMonth()) throw new Error("preflight_month_changed");
  };
  for (let i = 0; i < ids.length; i++) {
    checkWindow();
    const job = await loadJob(ids[i]);
    if (!job.title || !job.region || !job.work)
      throw new Error("public_job_fields");
    const body = buildClaudeRequest(job, model);
    checkWindow();
    // 比較付き更新で各回を確保。同じ開始値でbuildを再実行しても2度目は通らない。
    const claimed = await fetch(
      `${vault}/rest/v1/scout_ai_usage?month=eq.${month}&attempts=eq.${start + i}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ attempts: start + i + 1 }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!claimed.ok) throw new Error(`quota_http_${claimed.status}`);
    const claimedRows = await claimed.json();
    if (claimedRows.length !== 1 || claimedRows[0].attempts !== start + i + 1)
      throw new Error("quota_already_used_or_changed");
    checkWindow();
    console.log(
      "SCOUT_PREFLIGHT " +
        JSON.stringify({
          event: "request_reserved",
          jobId: job.id,
          attempts: start + i + 1,
        }),
    );
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: claudeHeaders,
      body,
      signal: AbortSignal.timeout(35000),
    });
    if (!response.ok)
      throw new Error(`claude_generation_http_${response.status}`);
    const raw = await response.json();
    const safeUsage = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;
    const stopReasons = [
      "end_turn",
      "tool_use",
      "max_tokens",
      "refusal",
      "stop_sequence",
      "pause_turn",
      "model_context_window_exceeded",
    ];
    console.log(
      "SCOUT_PREFLIGHT " +
        JSON.stringify({
          event: "response_received",
          jobId: job.id,
          stopReason: stopReasons.includes(raw?.stop_reason)
            ? raw.stop_reason
            : "unknown",
          usage: {
            input: safeUsage(raw?.usage?.input_tokens),
            output: safeUsage(raw?.usage?.output_tokens),
          },
          attempts: start + i + 1,
        }),
    );
    let result;
    try {
      result = parseClaudeResponse(raw, job, model);
    } catch {
      throw new Error("claude_response_rejected");
    }
    if (result.model !== model) throw new Error("generated_model_mismatch");
    console.log(
      "SCOUT_PREFLIGHT " +
        JSON.stringify({
          jobId: job.id,
          title: job.title,
          url: job.url,
          model: result.model,
          usage: result.usage,
          plan: result.plan,
          attempts: start + i + 1,
          emailSent: false,
          applicantDataSent: false,
        }),
    );
  }
  console.log(
    "SCOUT_PREFLIGHT " +
      JSON.stringify({ complete: true, tests: 3, emailSent: false }),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runPreflight(process.argv.slice(2)).catch((error) => {
    // 生のプロバイダ応答・リクエスト・秘密値を出さない。
    const safe =
      error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "preflight_failed";
    console.error(
      "SCOUT_PREFLIGHT " + JSON.stringify({ complete: false, error: safe }),
    );
    process.exitCode = 1;
  });

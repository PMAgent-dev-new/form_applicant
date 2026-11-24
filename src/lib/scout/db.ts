import { scoutConfig, ScoutError } from "./config";

export async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = scoutConfig();
  const r = await fetch(`${c.databaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.serviceKey,
      Authorization: `Bearer ${c.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok)
    throw new ScoutError(
      "記録を確認できません。時間をおいて再度確認してください",
    );
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}
export const rpc = <T>(name: string, args: Record<string, unknown>) =>
  db<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

export async function dbAll<T>(
  table: string,
  params: URLSearchParams,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 50_000; offset += 500) {
    const q = new URLSearchParams(params);
    q.set("limit", "500");
    q.set("offset", String(offset));
    const page = await db<T[]>(`${table}?${q}`);
    if (!Array.isArray(page))
      throw new ScoutError("記録の形式を確認できません");
    rows.push(...page);
    if (page.length < 500) return rows;
  }
  throw new ScoutError("対象件数が取得上限を超えています");
}

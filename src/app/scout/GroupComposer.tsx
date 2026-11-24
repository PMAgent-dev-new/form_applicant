"use client";
import { useEffect, useRef, useState } from "react";
import { apiPath } from "@/lib/basePath";
import type { CandidateGroup, Proposal } from "@/lib/scout/groups";
import type { ScoutBatch } from "@/lib/scout/batch";
import type { ScoutMessageView } from "@/lib/scout/types";
type ProposalView = {
  proposal: Proposal;
  groups: CandidateGroup[];
  excluded: {
    consentOrStop: number;
    recentOrUnknown: number;
    duplicates: number;
  };
  maxRecipients: number;
};
type BatchView = {
  batch: ScoutBatch;
  messages: ScoutMessageView[];
  step?: string;
  partial?: boolean;
};
type Copy = { subject: string; body: string };
async function api<T>(path: string, data?: unknown): Promise<T> {
  const r = await fetch(apiPath(`/api/scout/${path}`), {
    method: data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "処理を確認できませんでした");
  return body;
}
const states: Record<string, string> = {
  prepared: "最終確認待ち",
  approved: "送信を承認済み",
  paused: "中断中",
  completed: "全件の処理完了",
  draft: "未送信",
  accepted: "Gmail受理済み",
  sending: "処理中・結果確認が必要",
  unknown: "結果未確認・再送不可",
};
export default function GroupComposer({
  enabled,
  aiEnabled,
}: {
  enabled: boolean;
  aiEnabled: boolean;
}) {
  const [jobInput, setJobInput] = useState(""),
    [view, setView] = useState<ProposalView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [copies, setCopies] = useState<Record<string, Copy>>({});
  const [conditions, setConditions] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [current, setCurrent] = useState<BatchView | null>(null),
    [previewId, setPreviewId] = useState("");
  const [recent, setRecent] = useState<ScoutBatch[]>([]),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false),
    [error, setError] = useState("");
  const stopped = useRef(true),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    api<{ batches: ScoutBatch[] }>("batches")
      .then((r) => {
        if (alive.current) setRecent(r.batches);
      })
      .catch(() => {});
    return () => {
      stopped.current = true;
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    if (running) window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (ids: string[], checked: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
    if (next.size > 300) {
      setError("1回300人までです。グループ内の対象者を絞ってください。");
      return;
    }
    setSelected(next);
    setConditions(false);
    setError("");
  };
  const setBatch = (b: BatchView) => {
    setCurrent(b);
    setRecent((rows) =>
      [b.batch, ...rows.filter((r) => r.id !== b.batch.id)].slice(0, 30),
    );
    setPreviewId(
      b.messages.find((m) => m.status === "draft")?.id ||
        b.messages[0]?.id ||
        "",
    );
  };
  const create = async () => {
    let id = jobInput.trim();
    if (id.startsWith("https:")) {
      const u = new URL(id);
      if (u.hostname !== "ridejob.jp" || !/^\/job\/[^/]+\/?$/.test(u.pathname))
        throw new Error("RIDE JOBの求人詳細URLを指定してください");
      id = u.pathname.split("/")[2];
    }
    const v = await api<ProposalView>("proposals", { jobId: id });
    setView(v);
    setCurrent(null);
    setSelected(new Set());
    setConditions(false);
    setCopies(
      Object.fromEntries(
        v.groups.map((g) => [
          g.id,
          { subject: v.proposal.plan.subject, body: v.proposal.plan.body },
        ]),
      ),
    );
  };
  const prepare = async () => {
    if (!view) return;
    const selections = view.groups
      .map((g) => ({
        groupId: g.id,
        candidateIds: g.candidates
          .filter((c) => selected.has(c.id))
          .map((c) => c.id),
        ...copies[g.id],
      }))
      .filter((g) => g.candidateIds.length);
    setBatch(
      await api<BatchView>("batches", {
        action: "prepare",
        proposalId: view.proposal.id,
        selections,
        conditionsConfirmed: conditions,
      }),
    );
    setConfirmed(false);
  };
  const deliver = async (action: "approve" | "resume") => {
    if (!current) return;
    setError("");
    setRunning(true);
    setBusy(true);
    stopped.current = false;
    try {
      let next = await api<BatchView>("batches", {
        batchId: current.batch.id,
        action,
        confirmed,
      });
      next = {
        ...next,
        messages: next.messages.map((m) => ({
          ...current.messages.find((old) => old.id === m.id),
          ...m,
        })),
      };
      if (alive.current) setCurrent(next);
      while (
        !stopped.current &&
        alive.current &&
        next.batch.status === "approved"
      ) {
        const update = await api<BatchView>("batches", {
          batchId: next.batch.id,
          action: "next",
        });
        next = update.partial
          ? {
              ...update,
              messages: next.messages.map((m) => ({
                ...m,
                ...update.messages.find((u) => u.id === m.id),
              })),
            }
          : update;
        if (next.batch.status === "completed") {
          // 別タブで処理された結果も含め、完了時に一覧を同期する。
          const final = await api<BatchView>(
            `batches?id=${encodeURIComponent(next.batch.id)}`,
          );
          next = {
            ...final,
            messages: final.messages.map((m) => ({
              ...next.messages.find((old) => old.id === m.id),
              ...m,
            })),
          };
        }
        if (!alive.current) break;
        setCurrent(next);
        if (next.step === "busy") {
          setError("別の送信処理が動いています。状態を再取得してください。");
          break;
        }
      }
    } catch (e) {
      // 不明なリクエストを自動再試行しない。状態取得は送信を起こさない。
      if (alive.current)
        setError(
          `${(e as Error).message}。自動再試行していません。「状態を再取得」で結果を確認してください。`,
        );
    } finally {
      stopped.current = true;
      if (alive.current) {
        setRunning(false);
        setBusy(false);
        setConfirmed(false);
      }
    }
  };
  const pause = async () => {
    stopped.current = true;
    if (!current) return;
    try {
      setCurrent(
        await api<BatchView>("batches", {
          batchId: current.batch.id,
          action: "pause",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
    setConfirmed(false);
  };
  const preview =
    current?.messages.find((m) => m.id === previewId) || current?.messages[0];
  return (
    <div className="scout-group-workspace">
      <p className="scout-lead">
        求人を選ぶ → AIが候補グループと文面を作る →
        担当者が一括承認。メールは一人ずつ別々に届きます。
      </p>
      {error && (
        <div role="alert" className="scout-error">
          {error}
        </div>
      )}
      {!aiEnabled && !current && (
        <div className="scout-note">
          Claudeの接続準備中です。接続・利用枠の設定後にAI作成を利用できます。
        </div>
      )}
      {!!recent.length && !running && (
        <details className="scout-panel scout-recent">
          <summary>最近の送信グループを開く</summary>
          <div className="scout-inline">
            <select
              aria-label="最近の送信グループ"
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (id)
                  void run(async () => {
                    setBatch(
                      await api<BatchView>(
                        `batches?id=${encodeURIComponent(id)}`,
                      ),
                    );
                    setConfirmed(false);
                  });
              }}
            >
              <option value="">選択してください</option>
              {recent.map((b) => (
                <option key={b.id} value={b.id}>
                  {new Date(b.created_at).toLocaleString("ja-JP")} / {b.total}人
                  / {states[b.status]}
                </option>
              ))}
            </select>
          </div>
        </details>
      )}
      {!current ? (
        <>
          <section className="scout-panel">
            <p className="scout-eyebrow">01 / JOB</p>
            <h2>紹介する公開求人</h2>
            <label>
              RIDE JOBの求人詳細URL または求人ID
              <div className="scout-inline">
                <input
                  value={jobInput}
                  onChange={(e) => setJobInput(e.target.value)}
                  placeholder="https://ridejob.jp/job/…"
                  disabled={busy}
                />
                <button
                  disabled={busy || !aiEnabled || !jobInput.trim()}
                  onClick={() => void run(create)}
                >
                  {busy ? "準備中…" : "AIで候補と文面を作成"}
                </button>
              </div>
            </label>
            <p className="scout-muted">
              AIへ渡すのは公開求人のみです。登録者の情報は自社側で照合します。
            </p>
          </section>
          {view && (
            <>
              <section className="scout-panel">
                <p className="scout-eyebrow">02 / GROUPS & MESSAGE</p>
                <h2>候補グループと送付文</h2>
                <div className="scout-job">
                  <strong>{view.proposal.job_snapshot.title}</strong>
                  <p>
                    {view.proposal.job_snapshot.company} /{" "}
                    {view.proposal.job_snapshot.region}
                  </p>
                  <a
                    href={view.proposal.job_snapshot.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    求人原文を確認
                  </a>
                </div>
                <p>{view.proposal.plan.rationale}</p>
                <p className="scout-muted">
                  同じ都道府県に居住していても、通勤可否や希望勤務地は未確認です。資格の記載一致は応募条件の適合判定ではありません。
                </p>
                <details>
                  <summary>AIが挙げた確認点と求人の条件</summary>
                  <ul>
                    {view.proposal.plan.checks.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                  <pre className="scout-mail">
                    {view.proposal.job_snapshot.requirements?.replace(
                      /<[^>]*>/g,
                      " ",
                    ) || "求人詳細をご確認ください"}
                  </pre>
                </details>
                <div className="scout-results">
                  <h2>
                    {selected.size}
                    <small> / 300人 選択中</small>
                  </h2>
                  <span>
                    同意・停止で除外 {view.excluded.consentOrStop}件 / 送信制限{" "}
                    {view.excluded.recentOrUnknown}件 / 重複{" "}
                    {view.excluded.duplicates}件
                  </span>
                </div>
                {!view.groups.length && (
                  <p className="scout-empty">
                    現在の条件で送信候補は見つかりませんでした。同意未確認の方を自動で追加することはありません。
                  </p>
                )}
              </section>
              {view.groups.map((g) => (
                <section className="scout-panel" key={g.id}>
                  <label className="scout-check">
                    <input
                      type="checkbox"
                      checked={g.candidates.every((c) => selected.has(c.id))}
                      disabled={busy}
                      onChange={(e) =>
                        toggle(
                          g.candidates.map((c) => c.id),
                          e.target.checked,
                        )
                      }
                    />
                    <strong>
                      {g.label}（{g.candidates.length}人）を選択
                    </strong>
                  </label>
                  {g.candidates.length > 300 && (
                    <div className="scout-actions">
                      <button
                        className="secondary"
                        disabled={busy || selected.size >= 300}
                        onClick={() =>
                          toggle(
                            g.candidates
                              .filter((c) => !selected.has(c.id))
                              .slice(0, 300 - selected.size)
                              .map((c) => c.id),
                            true,
                          )
                        }
                      >
                        登録日が新しい順に上限まで選択
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          toggle(
                            g.candidates.map((c) => c.id),
                            false,
                          )
                        }
                      >
                        このグループを選択解除
                      </button>
                    </div>
                  )}
                  <details>
                    <summary>対象者を確認・調整する</summary>
                    <div className="scout-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>選択／候補者</th>
                            <th>選定理由・資格</th>
                            <th>現在の対応状況</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.candidates.map((c) => (
                            <tr key={c.id}>
                              <td>
                                <label className="scout-check">
                                  <input
                                    type="checkbox"
                                    aria-label={`${c.name}を選択`}
                                    checked={selected.has(c.id)}
                                    disabled={busy}
                                    onChange={(e) =>
                                      toggle([c.id], e.target.checked)
                                    }
                                  />
                                  <span>
                                    {c.name}
                                    <small>{c.email}</small>
                                  </span>
                                </label>
                              </td>
                              <td>
                                {c.reason}
                                <small>
                                  {c.qualifications || "資格未登録"}
                                </small>
                              </td>
                              <td>{c.status || "未確認"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <div className="scout-group-copy">
                    <label>
                      件名
                      <input
                        aria-label={`${g.label}の件名`}
                        value={copies[g.id]?.subject || ""}
                        maxLength={120}
                        disabled={busy}
                        onChange={(e) => {
                          setCopies({
                            ...copies,
                            [g.id]: {
                              ...copies[g.id],
                              subject: e.target.value,
                            },
                          });
                          setConditions(false);
                        }}
                      />
                    </label>
                    <label>
                      このグループへの本文
                      <textarea
                        aria-label={`${g.label}の本文`}
                        rows={8}
                        maxLength={4000}
                        value={copies[g.id]?.body || ""}
                        disabled={busy}
                        onChange={(e) => {
                          setCopies({
                            ...copies,
                            [g.id]: { ...copies[g.id], body: e.target.value },
                          });
                          setConditions(false);
                        }}
                      />
                    </label>
                    <p className="scout-muted">
                      宛名・求人リンク・担当者名・配信停止リンクは自動で付きます。
                    </p>
                  </div>
                </section>
              ))}
              {!!view.groups.length && (
                <section className="scout-panel">
                  <label className="scout-check">
                    <input
                      type="checkbox"
                      checked={conditions}
                      onChange={(e) => setConditions(e.target.checked)}
                      disabled={busy}
                    />
                    現在募集中・紹介可能な求人であること、対象者全員の条件・他担当の対応状況、文面を確認しました
                  </label>
                  <button
                    disabled={busy || !conditions || !selected.size}
                    onClick={() => void run(prepare)}
                  >
                    {selected.size}人分の送信内容を確認
                  </button>
                </section>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <section className="scout-panel">
            <p className="scout-eyebrow">03 / REVIEW & DELIVERY</p>
            <h2>{current.batch.total}人への送信内容</h2>
            <p>
              {states[current.batch.status]} ／ Gmail受理{" "}
              {current.messages.filter((m) => m.status === "accepted").length}件
              ／ 未送信{" "}
              {current.messages.filter((m) => m.status === "draft").length}件 ／
              結果要確認{" "}
              {
                current.messages.filter((m) =>
                  ["sending", "unknown"].includes(m.status),
                ).length
              }
              件
            </p>
            {current.batch.last_error && (
              <p className="scout-error">{current.batch.last_error}</p>
            )}
            <p className="scout-muted">
              各メールは個別送信です。他の受信者の宛先は見えません。Gmail受理は到達・開封を意味しません。
            </p>
            <div className="scout-table-wrap scout-recipient-list">
              <table>
                <thead>
                  <tr>
                    <th>宛先</th>
                    <th>件名</th>
                    <th>状態／文面</th>
                  </tr>
                </thead>
                <tbody>
                  {current.messages.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {m.candidate_name}
                        <small>{m.email}</small>
                      </td>
                      <td>{m.subject}</td>
                      <td>
                        {states[m.status]}
                        <button
                          className="scout-back"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const response = await api<{
                                message: ScoutMessageView;
                              }>(
                                `batches?id=${current.batch.id}&messageId=${m.id}`,
                              );
                              setCurrent((old) =>
                                old
                                  ? {
                                      ...old,
                                      messages: old.messages.map((row) =>
                                        row.id === m.id
                                          ? { ...row, ...response.message }
                                          : row,
                                      ),
                                    }
                                  : old,
                              );
                              setPreviewId(m.id);
                            })
                          }
                        >
                          この方の文面
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview && (
              <>
                <dl>
                  <dt>送信元</dt>
                  <dd>{preview.from_email}</dd>
                  <dt>返信先</dt>
                  <dd>{preview.reply_to}</dd>
                  <dt>宛先</dt>
                  <dd>
                    {preview.candidate_name} / {preview.email}
                  </dd>
                </dl>
                <h3>{preview.subject}</h3>
                <pre className="scout-mail">
                  {preview.body || "「この方の文面」から全文を確認できます。"}
                </pre>
              </>
            )}
            {current.batch.status !== "completed" && (
              <>
                <label className="scout-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    disabled={busy}
                  />
                  対象者一覧と各グループの最終文面を確認し、この内容で送信することを承認します
                </label>
                <div className="scout-actions">
                  {running ? (
                    <button className="secondary" onClick={() => void pause()}>
                      ここで中断する
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setBatch(
                            await api<BatchView>(
                              `batches?id=${current.batch.id}`,
                            ),
                          );
                          setConfirmed(false);
                        })
                      }
                    >
                      状態を再取得
                    </button>
                  )}
                  <button
                    disabled={busy || !enabled || !confirmed}
                    onClick={() =>
                      void deliver(
                        current.batch.status === "prepared"
                          ? "approve"
                          : "resume",
                      )
                    }
                  >
                    {running
                      ? "個別に送信しています…"
                      : current.batch.status === "prepared"
                        ? `${current.batch.total}人分を承認して送信`
                        : "未送信分の送信を再開"}
                  </button>
                </div>
                <p className="scout-muted">
                  送信中はこの画面を開いたままにしてください。中断時も処理中の1通は送信される場合があります。承認は2時間有効で、結果不明のメールは自動再送しません。
                </p>
              </>
            )}
            {!running && (
              <button
                className="scout-back"
                onClick={() => {
                  setCurrent(null);
                  setConfirmed(false);
                }}
              >
                ← グループ・文面の編集へ
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

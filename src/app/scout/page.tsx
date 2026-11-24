"use client";
import { useEffect, useState, type FormEvent } from "react";
import { apiPath } from "@/lib/basePath";
import type {
  Candidate,
  ScoutJob,
  ScoutMessage,
  Staff,
} from "@/lib/scout/types";
type Item = Pick<
  Candidate,
  | "id"
  | "name"
  | "role"
  | "region"
  | "qualifications"
  | "status"
  | "appliedAt"
  | "email"
> & { allowed: boolean; reasons: string[] };
type List = {
  candidates: Item[];
  total: number;
  eligible: number;
  page: number;
  checkedAt: string;
};
type Detail = {
  candidate: Candidate;
  eligibility: { allowed: boolean; reasons: string[] };
};
const labels: Record<string, string> = {
  draft: "確認待ち",
  sending: "送信処理中／結果要確認",
  accepted: "Gmail受理済み",
  unknown: "送信結果未確認",
};
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(apiPath(`/api/scout/${path}`), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
    credentials: "same-origin",
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "処理を完了できませんでした");
  return result;
}
export default function ScoutPage() {
  const [staff, setStaff] = useState<Staff | null>(null),
    [ready, setReady] = useState(false),
    [enabled, setEnabled] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [view, setView] = useState<"search" | "history">("search"),
    [query, setQuery] = useState(""),
    [role, setRole] = useState(""),
    [list, setList] = useState<List | null>(null);
  const [selected, setSelected] = useState<Detail | null>(null),
    [jobInput, setJobInput] = useState(""),
    [job, setJob] = useState<ScoutJob | null>(null);
  const [subject, setSubject] = useState(
      "【RIDE JOB】ご希望に合うお仕事のご案内",
    ),
    [body, setBody] = useState(""),
    [checked, setChecked] = useState(false),
    [finalChecked, setFinalChecked] = useState(false),
    [draft, setDraft] = useState<ScoutMessage | null>(null);
  const [history, setHistory] = useState<{
    messages: ScoutMessage[];
    pendingStopSync: number;
  } | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let alive = true;
    api<{ staff: Staff; sendingEnabled: boolean }>("session")
      .then((s) => {
        if (alive) {
          setStaff(s.staff);
          setEnabled(s.sendingEnabled);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  const search = async (page = 0) => {
    setList(
      await api<List>(
        `candidates?${new URLSearchParams({ q: query, role, page: String(page) })}`,
      ),
    );
  };
  const showHistory = async () => {
    setHistory(await api("history"));
    setView("history");
  };
  const select = async (id: string) => {
    const d = await api<Detail>(`candidates?id=${encodeURIComponent(id)}`);
    setSelected(d);
    setJob(null);
    setJobInput("");
    setDraft(null);
    setChecked(false);
    setFinalChecked(false);
    setBody(
      `RIDE JOBの${staff?.display_name || "担当者"}です。\nご登録内容を拝見し、お仕事をご紹介したくご連絡しました。\n\nこちらの求人をおすすめする理由や、ご経験とのつながりをご記入ください。\n現在のご希望と異なる場合も、お気軽にお知らせください。`,
    );
  };
  const lookup = async () => {
    let id = jobInput.trim();
    if (id.startsWith("https:")) {
      const u = new URL(id);
      if (u.hostname !== "ridejob.jp" || !/^\/job\/[^/]+\/?$/.test(u.pathname))
        throw new Error("RIDE JOBの求人詳細URLを入力してください");
      id = u.pathname.split("/")[2];
    }
    const data = await api<{ job: ScoutJob }>(
      `jobs?id=${encodeURIComponent(id)}`,
    );
    setJob(data.job);
    setDraft(null);
    setChecked(false);
  };
  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      const r = await api<{ staff: Staff }>("session", {
        method: "POST",
        body: JSON.stringify({
          email: f.get("email"),
          password: f.get("password"),
        }),
      });
      setStaff(r.staff);
      const s = await api<{ sendingEnabled: boolean }>("session");
      setEnabled(s.sendingEnabled);
    });
  };
  if (!ready)
    return (
      <main className="scout-login">
        <p>接続を確認しています…</p>
      </main>
    );
  if (!staff)
    return (
      <main className="scout-login">
        <div className="scout-brand">
          RIDE JOB <small>SCOUT</small>
        </div>
        <h1>担当者ログイン</h1>
        <p>利用を許可されたPMA担当者のアカウントでログインしてください。</p>
        <form onSubmit={login}>
          <label>
            会社メールアドレス
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            パスワード
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={busy}>ログイン</button>
        </form>
        {error && (
          <p role="alert" className="scout-error">
            {error}
          </p>
        )}
        <p className="scout-muted">
          アカウントの追加・再設定は管理者にご依頼ください。
        </p>
      </main>
    );
  return (
    <div className="scout-shell">
      <aside className="scout-sidebar">
        <div className="scout-brand">
          RIDE JOB<small>SCOUT / PMA</small>
        </div>
        <p>登録者に、次の選択肢を。</p>
        <nav aria-label="スカウトメニュー">
          <button
            className={view === "search" ? "active" : ""}
            onClick={() => {
              setView("search");
              setSelected(null);
              setDraft(null);
            }}
          >
            候補者を探す
          </button>
          <button
            className={view === "history" ? "active" : ""}
            disabled={busy}
            onClick={() => run(showHistory)}
          >
            送信履歴
          </button>
        </nav>
        <div className="scout-user">
          <strong>{staff.display_name}</strong>
          <span>{staff.email}</span>
          <button
            onClick={() =>
              run(async () => {
                await api("session", { method: "DELETE" });
                setStaff(null);
                setSelected(null);
                setList(null);
                setHistory(null);
              })
            }
          >
            ログアウト
          </button>
        </div>
      </aside>
      <main className="scout-main">
        <header className="scout-heading">
          <div>
            <p className="scout-eyebrow">PMA SCOUT DESK</p>
            <h1>
              {view === "history"
                ? "送信履歴"
                : selected
                  ? "スカウトを作成"
                  : "候補者を探す"}
            </h1>
          </div>
          <span className="scout-badge">
            {enabled ? "個別メール送信" : "実送信：準備中"}
          </span>
        </header>
        {!enabled && (
          <div className="scout-note">
            現在は実送信を無効にしています。設定と本番確認が完了すると送信できます。
          </div>
        )}
        {error && (
          <div role="alert" className="scout-error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="scout-note">
            {notice}
          </div>
        )}
        {view === "history" ? (
          <>
            <p className="scout-muted">
              最新100件。Gmailの受理は、受信箱への到達・開封を意味しません。返信・面談は担当者が確認して更新します。
            </p>
            {!!history?.pendingStopSync && (
              <div className="scout-error">
                配信停止のLark反映が未確認：{history.pendingStopSync}
                件。スカウト自体は停止済みです。管理者が反映状況を確認してください。
              </div>
            )}
            <div className="scout-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>候補者／日時</th>
                    <th>件名</th>
                    <th>送信状態</th>
                    <th>対応状況</th>
                  </tr>
                </thead>
                <tbody>
                  {history?.messages.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.candidate_name}</strong>
                        <small>
                          {new Date(m.sent_at || m.created_at).toLocaleString(
                            "ja-JP",
                          )}
                        </small>
                      </td>
                      <td>
                        {m.subject}
                        <small>{m.id}</small>
                      </td>
                      <td>
                        {labels[m.status]}
                        {m.provider_id && <small>ID：{m.provider_id}</small>}
                      </td>
                      <td>
                        <select
                          aria-label={`${m.candidate_name}の対応状況`}
                          value={m.outcome}
                          disabled={busy || m.status !== "accepted"}
                          onChange={(e) =>
                            run(async () => {
                              await api("history", {
                                method: "PATCH",
                                body: JSON.stringify({
                                  id: m.id,
                                  outcome: e.target.value,
                                }),
                              });
                              await showHistory();
                            })
                          }
                        >
                          <option value="none">返信未確認</option>
                          <option value="replied">返信あり</option>
                          <option value="meeting">面談につながった</option>
                          <option value="declined">辞退</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {history?.messages.length === 0 && (
                <p className="scout-empty">送信履歴はまだありません。</p>
              )}
            </div>
          </>
        ) : selected ? (
          <>
            <button
              className="scout-back"
              onClick={() => {
                setSelected(null);
                setDraft(null);
              }}
            >
              ← 候補者一覧へ
            </button>
            <div className="scout-compose">
              <section className="scout-panel">
                <p className="scout-eyebrow">CANDIDATE</p>
                <h2>{selected.candidate.name}</h2>
                <p>
                  {selected.candidate.role} /{" "}
                  {selected.candidate.region || "居住地未登録"}
                </p>
                <dl>
                  <dt>メール</dt>
                  <dd>{selected.candidate.email || "未登録"}</dd>
                  <dt>資格</dt>
                  <dd>{selected.candidate.qualifications || "未登録"}</dd>
                  <dt>対応状況</dt>
                  <dd>{selected.candidate.status || "未確認"}</dd>
                  <dt>登録日</dt>
                  <dd>
                    {selected.candidate.appliedAt
                      ? new Date(
                          selected.candidate.appliedAt,
                        ).toLocaleDateString("ja-JP")
                      : "未登録"}
                  </dd>
                </dl>
                <div
                  className={
                    selected.eligibility.allowed ? "scout-note" : "scout-error"
                  }
                >
                  {selected.eligibility.allowed
                    ? "同意原本・配信停止を確認できました。送信直前に再確認します。"
                    : selected.eligibility.reasons.map((r) => (
                        <p key={r}>{r}</p>
                      ))}
                </div>
                <p className="scout-muted">
                  登録日は現在の転職意向を示すものではありません。条件・対応履歴も確認してください。
                </p>
              </section>
              <section className="scout-panel">
                {draft ? (
                  <>
                    <p className="scout-eyebrow">FINAL CHECK</p>
                    <h2>宛先・文面の最終確認</h2>
                    <dl>
                      <dt>宛先</dt>
                      <dd>{draft.email}</dd>
                      <dt>送信元</dt>
                      <dd>{draft.from_email}</dd>
                      <dt>返信先</dt>
                      <dd>{draft.reply_to}</dd>
                    </dl>
                    <h3>{draft.subject}</h3>
                    <pre className="scout-mail">{draft.body}</pre>
                    <label className="scout-check">
                      <input
                        type="checkbox"
                        checked={finalChecked}
                        onChange={(e) => setFinalChecked(e.target.checked)}
                      />
                      この宛先・求人・文面で1通送信することを確認しました
                    </label>
                    <div className="scout-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setDraft(null);
                          setFinalChecked(false);
                        }}
                      >
                        編集に戻る
                      </button>
                      <button
                        disabled={busy || !enabled || !finalChecked}
                        onClick={() =>
                          run(async () => {
                            const r = await api<{ status: string }>("send", {
                              method: "POST",
                              body: JSON.stringify({
                                draftId: draft.id,
                                confirmed: true,
                              }),
                            });
                            setDraft(null);
                            setSelected(null);
                            await showHistory();
                            setNotice(
                              r.status === "accepted"
                                ? "Gmailがメールを受け付けました。"
                                : "送信結果を確認できません。再送せず履歴を確認してください。",
                            );
                          })
                        }
                      >
                        {busy ? "処理中…" : "この内容で送信"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="scout-eyebrow">WRITE A SCOUT</p>
                    <h2>求人を選び、理由を伝える</h2>
                    <label>
                      RIDE JOBの求人詳細URL または求人ID
                      <div className="scout-inline">
                        <input
                          value={jobInput}
                          onChange={(e) => {
                            setJobInput(e.target.value);
                            setJob(null);
                            setChecked(false);
                          }}
                          placeholder="https://ridejob.jp/job/…"
                        />
                        <button
                          className="secondary"
                          disabled={busy || !jobInput.trim()}
                          onClick={() => run(lookup)}
                        >
                          求人を確認
                        </button>
                      </div>
                    </label>
                    {job && (
                      <div className="scout-job">
                        <strong>{job.title}</strong>
                        <p>
                          {job.company} / {job.region}
                        </p>
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          求人詳細を開く ↗
                        </a>
                      </div>
                    )}
                    <label>
                      件名
                      <input
                        maxLength={120}
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                      />
                    </label>
                    <label>
                      本文
                      <textarea
                        aria-label="本文"
                        rows={10}
                        maxLength={4000}
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                      />
                    </label>
                    <p className="scout-muted">
                      宛名・求人詳細・担当者名・配信停止リンクは自動で付けます。本文にはURLを貼らず、おすすめする理由を記載してください。
                    </p>
                    <label className="scout-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      現在募集中・紹介可能であること、候補者の条件、他担当の対応状況を確認しました
                    </label>
                    <button
                      disabled={
                        busy ||
                        !job ||
                        !checked ||
                        !selected.eligibility.allowed
                      }
                      onClick={() =>
                        run(async () => {
                          const r = await api<{ draft: ScoutMessage }>(
                            "drafts",
                            {
                              method: "POST",
                              body: JSON.stringify({
                                candidateId: selected.candidate.id,
                                jobId: job!.id,
                                subject,
                                body,
                                conditionsConfirmed: checked,
                              }),
                            },
                          );
                          setDraft(r.draft);
                          setFinalChecked(false);
                        })
                      }
                    >
                      送信内容を確認する
                    </button>
                  </>
                )}
              </section>
            </div>
          </>
        ) : (
          <>
            <p className="scout-lead">
              ご登録いただいた方へ、一人ひとりに合った求人を提案しましょう。
            </p>
            <form
              className="scout-search"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => search(0));
              }}
            >
              <label>
                氏名・居住地・資格
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="例：埼玉県、大型免許"
                />
              </label>
              <label>
                職種
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">すべての職種</option>
                  {["タクシー", "トラック", "整備士", "講師"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>
                {busy ? "最新データを取得中…" : "候補者を検索"}
              </button>
            </form>
            {list ? (
              <>
                <div className="scout-results">
                  <h2>
                    {list.total.toLocaleString()} <small>登録レコード</small>
                  </h2>
                  <span>
                    同意・停止確認済み {list.eligible.toLocaleString()}件
                  </span>
                </div>
                <p className="scout-muted">
                  同じ方の複数応募を含みます。送信可否・送信間隔は確認画面で再判定します。
                </p>
                <div className="scout-cards">
                  {list.candidates.map((c) => (
                    <article key={c.id} className="scout-card">
                      <div>
                        <span
                          className={c.allowed ? "scout-pill ok" : "scout-pill"}
                        >
                          {c.allowed ? "文面作成可" : "要確認"}
                        </span>
                        <p className="scout-id">{c.id}</p>
                        <h2>{c.name}</h2>
                        <p>{c.role}</p>
                      </div>
                      <div>
                        <strong>{c.region || "居住地未登録"}</strong>
                        <p>{c.qualifications || "資格未登録"}</p>
                        <small>{c.email}</small>
                      </div>
                      <div className="scout-card-end">
                        <p>
                          {c.allowed
                            ? "個別に求人条件を確認してください"
                            : c.reasons[0]}
                        </p>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => run(() => select(c.id))}
                        >
                          プロフィールを見る
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {list.candidates.length === 0 && (
                  <p className="scout-empty">条件に合う候補者はいません。</p>
                )}
                <div className="scout-pagination">
                  <button
                    className="secondary"
                    disabled={busy || list.page === 0}
                    onClick={() => run(() => search(list.page - 1))}
                  >
                    前へ
                  </button>
                  <span>{list.page + 1}ページ</span>
                  <button
                    className="secondary"
                    disabled={busy || (list.page + 1) * 30 >= list.total}
                    onClick={() => run(() => search(list.page + 1))}
                  >
                    次へ
                  </button>
                </div>
              </>
            ) : (
              <div className="scout-empty">
                <h2>候補者を検索してはじめる</h2>
                <p>
                  同意・配信停止を含め、Larkと応募受付台帳の最新状態を確認します。
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

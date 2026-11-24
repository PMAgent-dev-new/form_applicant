"use client";
import { useState } from "react";
import { apiPath } from "@/lib/basePath";
export default function UnsubscribePage() {
  const [done, setDone] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="scout-login">
      <div className="scout-brand">RIDE JOB</div>
      <h1>{done ? "配信を停止しました" : "スカウトメールの配信停止"}</h1>
      <p>
        {done
          ? "このメールアドレスへのスカウトメールを停止しました。"
          : "今後のスカウトメールを停止する場合は、下のボタンを押してください。"}
      </p>
      <p>お申し込み済みの応募・選考に必要な連絡は継続します。</p>
      {!done && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const token =
                new URLSearchParams(window.location.search).get("token") || "";
              const r = await fetch(apiPath("/api/scout/unsubscribe"), {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ token }),
              });
              if (!r.ok)
                throw new Error(
                  "配信停止を完了できませんでした。メールのリンクをご確認ください。",
                );
              setDone(true);
              window.history.replaceState(null, "", window.location.pathname);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "処理中…" : "スカウトメールを停止する"}
        </button>
      )}
      {error && (
        <p role="alert" className="scout-error">
          {error}
        </p>
      )}
    </main>
  );
}

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createBaseRecord, isLarkBaseConfigured } from "@/lib/larkBase";
import { saveToSubmissionVault } from "@/lib/submissionVault";

// 2027新卒 鈑金塗装職LP（/gulliver/newgraduate → 本番は /entry/gulliver/newgraduate）の
// 会社説明会お申し込み受付。
//   1) Lark Base(Bitable)「IDOM_新卒2027」テーブルへレコード登録（永続化／主処理。失敗時はエラー）
//   2) Lark チャットへ Webhook 通知（即時把握用／ベストエフォート。失敗しても申込は成功扱い）

// 投入先テーブル。既定は IDOM_新卒2027（tblfCA6cyDp8ZGao）。
const TABLE_ID = process.env.LARK_BASE_TABLE_ID_GULLIVER_BP || "tblfCA6cyDp8ZGao";

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    // ハニーポット: 隠しフィールドに値があれば bot とみなし、黙って成功扱いで破棄。
    const honeypot = (form.get("company_url") || "").toString().trim();
    if (honeypot) {
      return NextResponse.json({ ok: true });
    }

    const name = cap((form.get("name") || "").toString().trim(), 100);
    const email = cap((form.get("email") || "").toString().trim(), 254);
    const tel = cap((form.get("tel") || "").toString().trim(), 32);
    const area = cap((form.get("area") || "").toString().trim(), 100);

    const errors: string[] = [];
    if (!name) errors.push("お名前は必須です。");
    if (!email) errors.push("メールアドレスは必須です。");
    else if (!isValidEmail(email)) errors.push("メールアドレスの形式が正しくありません。");
    if (!tel) errors.push("電話番号は必須です。");
    else if (!/^[0-9\-+() ]{10,}$/.test(tel)) errors.push("電話番号の形式が正しくありません。");

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    }

    // 冪等キー。同じ人が同じ日に複数回送っても退避側の unique index で1行に畳まれる。
    const submissionId = `entry-bp:${createHash("sha256")
      .update(`${email}|${tel}|${new Date().toISOString().slice(0, 10)}`)
      .digest("hex")
      .slice(0, 32)}`;
    const vaultPayload = { name, email, tel, area } as Record<string, unknown>;
    let baseSaveFailed = "";
    let vaultSaved = false;

    // --- 1) Lark Base 登録（主処理）---
    // 認証情報が未設定（本番 env 未投入など）の場合はスキップし、チャット通知だけ行う。
    // これによりフォーム自体は止まらず、env 投入後に自動で Base 登録が有効化される。
    if (isLarkBaseConfigured()) {
      try {
        await createBaseRecord(TABLE_ID, {
          求職者名: name,
          メールアドレス: email,
          電話番号: tel || undefined,
          ステータス: "リード",
          登録職種: "板金/塗装技能士",
          応募日: Date.now(),
          クリエイティブ: "BP_2027新卒LP (/entry/gulliver/newgraduate)",
          対応履歴メモ: area ? `希望勤務エリア: ${area}` : undefined,
        });
      } catch (e) {
        // ⚠️ 2026-09-24: ここで 502 を返していた。通知はこの後ろなので、Base が落ちると
        // 申込内容はどこにも残らず消える（2026-09-17〜24 の障害と同じ型）。
        // Base に入らなくても通知は出して申込は通す。
        baseSaveFailed = e instanceof Error ? e.message : String(e);
        console.error("[entry-bp] Lark Base 登録失敗:", e);
      }
    } else {
      baseSaveFailed = "Lark Base 認証情報が未設定";
      console.warn("[entry-bp] Lark Base 認証情報が未設定のため Base 登録をスキップ（チャット通知のみ）");
    }
    if (baseSaveFailed) {
      vaultSaved = await saveToSubmissionVault({
        source: "form_applicant/entry-bp",
        kind: "application",
        submissionId,
        profile: "mechanic",
        reason: `base save failed: ${baseSaveFailed}`,
        notified: false,
        payload: vaultPayload,
      });
    }

    // --- 2) Lark チャット通知（ベストエフォート）---
    let notified = false;
    const isProd = process.env.NODE_ENV === "production";
    const webhookUrl =
      process.env.LARK_WEBHOOK_URL_GULLIVER_BP_PROD ||
      process.env.LARK_WEBHOOK_URL_GULLIVER_BP ||
      (isProd ? process.env.LARK_WEBHOOK_URL_MECHANIC_PROD : process.env.LARK_WEBHOOK_URL_MECHANIC_TEST) ||
      process.env.LARK_WEBHOOK_URL_MECHANIC ||
      process.env.LARK_WEBHOOK_URL;

    if (webhookUrl) {
      const textLines: string[] = [
        baseSaveFailed
          ? "⚠️Base未登録（手入力が必要）【2027新卒 鈑金塗装職LP / Gulliver】会社説明会のお申し込みが届きました"
          : "【2027新卒 鈑金塗装職LP / Gulliver】会社説明会のお申し込みが届きました",
        `お名前: ${name}`,
        `メール: ${email}`,
        tel ? `電話: ${tel}` : undefined,
        area ? `希望エリア: ${area}` : undefined,
        "経路: /entry/gulliver/newgraduate (BP / 2027新卒)",
      ].filter((line): line is string => typeof line === "string");

      const payload = { msg_type: "text", content: { text: textLines.join("\n") } };

      try {
        const larkRes = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        const larkData = await larkRes.json().catch(() => ({} as { code?: number }));
        if (!larkRes.ok || (larkData && typeof larkData.code !== "undefined" && larkData.code !== 0)) {
          console.error("[entry-bp] Lark チャット通知失敗:", larkData);
        } else {
          notified = true;
        }
      } catch (e) {
        console.error("[entry-bp] Lark チャット通知エラー:", e);
      }
    }

    // ⚠️ Base にも通知にも退避にも残らないのに 200 を返すと、申込は無音で消える。
    // ここだけは申込者に再送してもらうしかない。
    if (baseSaveFailed && !notified && !vaultSaved) {
      console.error("[entry-bp] 申込がどこにも残らなかった", { submissionId });
      return NextResponse.json(
        { error: "送信に失敗しました。時間をおいて再度お試しください。" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  }
}

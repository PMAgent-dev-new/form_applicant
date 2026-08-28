/**
 * クーパン（ロケットナウ）導線のレイアウト。
 *
 * ルートの globals.css は `body::before`（position:fixed・全面）に
 * **RIDE JOBタクシーサイトのスクリーンショット画像**を敷いている。
 * これは固定配置なので、ページ本文より下までスクロールすると
 * 営業職の応募者にタクシー求人が見えてしまう（2026-08-27 実測で確認）。
 *
 * `body` の background-image を消すだけでは擬似要素は残るため、
 * `body::before` 自体を無効化する。ここは /coupang 配下すべて
 * （フォーム・完了ページ）に効く。
 */
export default function CoupangLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        body { background-image: none !important; background-color: #eff6ff !important; }
        body::before { display: none !important; content: none !important; }
      `}</style>
      {children}
    </>
  );
}

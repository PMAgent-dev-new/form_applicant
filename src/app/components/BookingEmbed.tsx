'use client';

type BookingEmbedProps = {
  slug: string;
  height?: number;
  className?: string;
};

export default function BookingEmbed({
  slug,
  height = 1600,
  className = '',
}: BookingEmbedProps) {
  const src = `https://eeasy-internal.vercel.app/book/${slug}`;

  return (
    <div className={className}>
      {/* 予約フォームは「面談方法」を選ぶまで日程ボタンが押せない仕様。
          PCではホバーでツールチップが出るがスマホでは何も表示されず「押せない」と誤解されるため、
          埋め込みの外側で先に案内する。 */}
      <p className="mb-3 text-sm font-semibold text-gray-900">
        はじめに「面談方法」をお選びください。選択すると日程が選べるようになります。
      </p>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_8px_20px_rgba(0,0,0,0.06)]">
        <iframe
          src={src}
          title="面談予約フォーム"
          loading="lazy"
          className="block w-full"
          style={{ height: `${height}px`, border: 'none' }}
          allow="clipboard-write"
        />
      </div>

      {/* 埋め込み(iframe)が表示されない・操作できない端末向けの逃げ道 */}
      <p className="mt-3 text-center text-sm">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#2205D9] underline underline-offset-2 hover:opacity-80"
        >
          予約フォームがうまく開かない場合はこちら（別のページで開く）
        </a>
      </p>
    </div>
  );
}

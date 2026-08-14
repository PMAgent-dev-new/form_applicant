import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // マルチゾーン配信: ridejob.jp 配下へ複製する deployment でのみ NEXT_PUBLIC_BASE_PATH=/entry を設定する。
  // 既存の ridejob.pmagent.jp（単独ドメイン）deployment では未設定＝basePathなし（挙動不変）。
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  images: {
    // Vercelで自動的にAVIF/WebP形式に変換
    formats: ['image/avif', 'image/webp'],
    // レスポンシブ画像のデバイスサイズ
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // 画像キャッシュの最小TTL（秒）
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.microcms-assets.io',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // /api/hiragana は kuromoji の辞書をサーバー側で読む。
  // Vercel の関数バンドルに node_modules/kuromoji/dict を含める必要がある
  // （動的な path.join なのでトレースが自動では拾えない）。
  outputFileTracingIncludes: {
    '/api/hiragana': ['./node_modules/kuromoji/dict/**'],
  },
};

export default nextConfig;

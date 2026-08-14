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
  async headers() {
    return [
      {
        // kuromoji の辞書（public/dict, 約17MB）は内容が変わらない不変ファイル。
        // 既定だと再訪のたびに再検証が走るので、長期キャッシュを明示する。
        source: '/dict/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;

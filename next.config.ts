import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost', '0.0.0.0'],
  // 기본 보안 헤더(이슈 #224). CSP는 인라인 스크립트 사용량 조사 후 별도 도입.
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    const base = [
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
    ];
    if (isProd) {
      base.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      });
    }
    return [
      {
        source: '/:path*',
        headers: base,
      },
    ];
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;

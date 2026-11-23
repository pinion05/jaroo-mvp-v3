import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost', '0.0.0.0', 'pop-os.tailcff214.ts.net'],
  // 기본 보안 헤더(이슈 #224). CSP는 인라인 스크립트 사용량 조사 후 별도 도입.
  // dev 배포(Railway dev 환경) 전용 수파베이스 내부 프록시 — 셀프호스팅 GoTrue·PostgREST를
  // 앱 도메인의 /auth/v1·/rest/v1 경로로 리라이트한다. 내부 프라이빗 호스트는 env로 주입받고,
  // 변수가 없는 운영(prod)·로컬에서는 빈 배열을 반환해 아무 경로도 바뀌지 않는다.
  async rewrites() {
    const authTarget = process.env.SUPABASE_AUTH_INTERNAL_URL?.replace(/\/+$/, '');
    const restTarget = process.env.SUPABASE_REST_INTERNAL_URL?.replace(/\/+$/, '');
    if (!authTarget || !restTarget) {
      return [];
    }
    return [
      { source: '/auth/v1/:path*', destination: `${authTarget}/:path*` },
      { source: '/rest/v1/:path*', destination: `${restTarget}/:path*` },
    ];
  },
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
      {
        // AI 트레이더 초안 카탈로그(public/ai-trader/catalog.html)가 같은 오리진
        // iframe으로 /ai-trader/draft-* 를 라이브 임베드한다. 전역 DENY 는 그대로
        // 두고 이 경로만 SAMEORIGIN 으로 완화(중복 키는 나중 매치가 이긴다 —
        // headers.md 'Header Overriding Behavior').
        source: '/ai-trader/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
    ];
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;

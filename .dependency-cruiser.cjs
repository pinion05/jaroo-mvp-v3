// dependency-cruiser 설정 — CI 가드레일 (#207 리뷰노트 #7)
// 목적: PR #207에서 해소한 순환 의존(jaroo-home-data ⇄ deepscan-target)이 재발하지 않도록
// import-no-cycle 을 에러로 잡는다. 로컬: npm run check:depcruise / CI: verify 잡 내 실패.
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: '순환 import 는 빌드/테스트 시점이 아니라 런타임에 터지는 경우가 많다. 순환을 끊고 공통 타입/유틸은 더 낮은 계층으로 내려라. (참고: holding-types.ts 패턴, PR #207)',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    // 루트 tsconfig 의 moduleResolution 'bundler' 는 depcruise 번들 TypeScript 가
    // 지원하지 않는다(이슈 #958). tsconfig.depcruise.json 은 moduleResolution 'node'
    // 로 같은 paths(@/*) 를 제공해 상대/alias 임포트를 모두 resolve 시킨다.
    // import type 엣지도 그래프에 포함한다. 런타임 순환뿐 아니라
    // 타입 전용 순환(jaroo-home-data ⇄ deepscan-target 재발 패턴)도 잡기 위함.
    tsConfig: {
      fileName: 'tsconfig.depcruise.json',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'require', 'default'],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};

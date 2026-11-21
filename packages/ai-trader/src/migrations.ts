// 마이그레이션 로더 — migrations/*.sql 을 파일명 정렬순으로 합쳐 Store 생성자에 전달.
// SQLite DDL은 멱등(IF NOT EXISTS·재구축 패턴)하게 작성한다: 스타트업마다 전체 재적용.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadMigrationsSql(migrationsDir?: string): string {
  // fileURLToPath 필수 — URL.pathname은 퍼센트 인코딩을 반환해 경로에 공백·비ASCII가
  // 있으면 scandir이 ENOENT로 죽는다 (평가 세션 실증).
  const dir = migrationsDir ?? fileURLToPath(new URL('../migrations/', import.meta.url))
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  return files.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n')
}

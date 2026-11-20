// 마이그레이션 로더 — migrations/*.sql 을 파일명 정렬순으로 합쳐 Store 생성자에 전달.
// SQLite DDL은 멱등(IF NOT EXISTS·재구축 패턴)하게 작성한다: 스타트업마다 전체 재적용.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadMigrationsSql(migrationsDir?: string): string {
  const dir = migrationsDir ?? new URL('../migrations/', import.meta.url).pathname
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  return files.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n')
}

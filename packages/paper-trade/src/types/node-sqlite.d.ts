// `node:sqlite` 최소 타입 선언 — 루트 @types/node가 ^20이라 이 모듈 타입이 없다.
// 루트 @types/node를 올리면 레포 전체 타입에 영향을 주므로, 이 패키지가 쓰는
// 표면만 여기에 선언한다(store.ts가 사용하는 API와 1:1).
// 런타임은 Node 22+의 내장 구현을 그대로 쓴다(실험적 — ExperimentalWarning).

declare module 'node:sqlite' {
  /** 바인딩 가능한 파라미터 — 이 패키지는 string | number | null만 사용한다. */
  type SqlValue = null | number | bigint | string | Uint8Array

  /** prepare()로 1회 생성해 재사용하는 동기 statement. */
  class StatementSync {
    run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
    get(...params: SqlValue[]): unknown
    all(...params: SqlValue[]): unknown[]
  }

  class DatabaseSync {
    /**
     * @param options.timeout SQLite busy timeout(ms). node:sqlite 기본값은 0이므로
     *   명시적으로 준다(동일 파일 접근 경합 시 즉시 SQLITE_BUSY로 죽지 않게).
     */
    constructor(path: string, options?: { timeout?: number })
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}

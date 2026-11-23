import { NextResponse, type NextRequest } from 'next/server'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * AI 트레이더 전체 파이프라인 트리거 — "갱신하기" 버튼이 호출한다.
 *
 * - POST: scripts/ai-trader/run-pipeline.mjs 를 detached 로 띄우고 즉시 응답.
 *   진행 상황은 파이프라인이 public/ai-trader/draft5-live.status.json 에
 *   기록하며 UI가 폴링한다 (이 라우트는 상태를 갖지 않는다).
 * - 싱글턴: status.running && pid 생존이면 409 — 중복 실행 방지.
 * - 개발 전용: 운영 빌드(NODE_ENV=production)에서는 404 (dev-tokens 라우트 패턴).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PIPELINE = path.join(process.cwd(), 'scripts', 'ai-trader', 'run-pipeline.mjs')
const STATUS = path.join(process.cwd(), 'public', 'ai-trader', 'draft5-live.status.json')
const LOG = '/tmp/ai-trader-pipeline.log'

type PipelineStatusFile = {
  running?: boolean
  pid?: number
  startedAt?: string
  lastRunAt?: string
  lastError?: string | null
}

async function readStatus(): Promise<PipelineStatusFile> {
  try {
    return JSON.parse(await fs.readFile(STATUS, 'utf8')) as PipelineStatusFile
  } catch {
    return {}
  }
}

/** pid 0-시그널 생존 검사 — 서버 재시작 등으로 죽은 잠금은 무시한다 */
function isAlive(pid?: number): boolean {
  if (!pid || !Number.isFinite(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function POST(_request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'dev-only' }, { status: 404 })
  }

  const status = await readStatus()
  if (status.running && isAlive(status.pid)) {
    return NextResponse.json(
      { ok: false, running: true, startedAt: status.startedAt ?? null },
      { status: 409 },
    )
  }

  try {
    // stdio에는 fd 번호를 넘긴다(신규 Node는 스트림 거부) — 자식은 자체 dup로 유지
    const logFile = await fs.open(LOG, 'a')
    try {
      const child = spawn(process.execPath, [PIPELINE], {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', logFile.fd, logFile.fd],
      })
      child.unref()
    } finally {
      await logFile.close()
    }
    return NextResponse.json({ ok: true, startedAt: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e).slice(0, 200) },
      { status: 500 },
    )
  }
}

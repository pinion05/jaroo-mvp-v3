import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { DebugManifest } from './dump-contract'

const execFileAsync = promisify(execFile)

export type DeepScanRawInputForDump = {
  instrument: {
    name?: string
    code?: string
    ticker?: string
    market?: string
    kind?: 'stock' | 'etf'
  }
  holding?: {
    shares?: string
    averagePrice?: string
    averagePriceCurrency?: string
    currentPriceCurrency?: string
    usdKrwRate?: string
    evaluationAmount?: string
  }
  selectedAt?: string
  sourceContext: {
    from?: string
  }
}

export type UsDumpRuntimeShape = {
  shared: unknown
  members: Record<string, unknown>
  axes?: Record<string, unknown>
}

export type UsDumpContractArtifacts = {
  root: string
  tickerDir: string
  manifest: DebugManifest
  runtimeShape: UsDumpRuntimeShape
}

function requireSinglePathLine(stdout: string) {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const last = lines.at(-1)
  if (!last) {
    throw new Error('dump contract generator did not print an artifact root')
  }

  return last
}

export async function generateUsDumpContractArtifacts(rawInput: DeepScanRawInputForDump, ticker: string): Promise<UsDumpContractArtifacts> {
  const projectRoot = /* turbopackIgnore: true */ process.cwd()
  const tempRoot = await mkdtemp(join(tmpdir(), 'jaroo-dump-input-'))
  const runtimeInputPath = join(tempRoot, 'runtime-input.json')

  try {
    await writeFile(runtimeInputPath, JSON.stringify(rawInput))

    const { stdout, stderr } = await execFileAsync(
      'python3',
      ['scripts/generate_llm_dump_examples.py', '--runtime-input-file', runtimeInputPath, ticker],
      {
        cwd: projectRoot,
        maxBuffer: 8 * 1024 * 1024,
      },
    )

    if (stderr?.trim()) {
      const noise = stderr.trim()
      if (noise.length > 0) {
        throw new Error(`dump contract generator stderr: ${noise}`)
      }
    }

    const root = requireSinglePathLine(stdout)
    const tickerDir = resolve(/* turbopackIgnore: true */ projectRoot, root, ticker.toUpperCase())
    const manifest = JSON.parse(await readFile(join(/* turbopackIgnore: true */ tickerDir, 'manifest.json'), 'utf8')) as DebugManifest
    const runtimeShape = JSON.parse(await readFile(join(/* turbopackIgnore: true */ tickerDir, 'processed', 'runtime-shape.json'), 'utf8')) as UsDumpRuntimeShape

    return {
      root: resolve(/* turbopackIgnore: true */ projectRoot, root),
      tickerDir,
      manifest,
      runtimeShape,
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

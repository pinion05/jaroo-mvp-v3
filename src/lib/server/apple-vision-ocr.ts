import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { sanitizeOcrRows, type OcrRow } from '@/lib/screenshot-ocr'

const execFileAsync = promisify(execFile)

const HEADER_LINE_PATTERNS = [/종목명/i, /보유수량/i, /수익률/i, /평가금/i, /market value/i, /return/i, /qty/i]
const PROFIT_RATE_REGEX = /[+-]?\d[\d,]*(?:\.\d+)?%/
const AMOUNT_PREFIX_REGEX = /^([₩$€¥£]?\s*[+-]?\d[\d,]*(?:\.\d+)?(?:\s*(?:원|krw|usd|eur|jpy|cny|aud|cad|hkd))?)/i
const QUANTITY_REGEX = /[+-]?\d[\d,]*(?:\.\d+)?(?:\s*(?:주|shares?|stocks?))?/gi
const APPLE_VISION_SCRIPT_PATH = join(process.cwd(), 'scripts', 'apple-vision-ocr.swift')

type ParsedImageDataUrl = {
  mimeType: string
  buffer: Buffer
  extension: string
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/svg+xml':
      return 'svg'
    default:
      return 'img'
  }
}

function parseImageDataUrl(imageDataUrl: string): ParsedImageDataUrl {
  const match = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+)(;base64)?,([\s\S]+)$/)

  if (!match?.[1] || !match[3]) {
    throw new Error('A valid imageDataUrl is required.')
  }

  const mimeType = match[1]
  const payload = match[3]
  const isBase64 = Boolean(match[2])
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')

  if (buffer.length === 0) {
    throw new Error('The image payload is empty.')
  }

  return {
    mimeType,
    buffer,
    extension: extensionForMimeType(mimeType),
  }
}

function normalizeLine(line: string) {
  return line.replace(/\s+/g, ' ').trim()
}

function isHeaderLine(line: string) {
  const normalized = normalizeLine(line)
  return HEADER_LINE_PATTERNS.some((pattern) => pattern.test(normalized))
}

function parseLineToRow(line: string): OcrRow | null {
  const normalized = normalizeLine(line)

  if (!normalized || isHeaderLine(normalized)) {
    return null
  }

  const profitMatch = normalized.match(PROFIT_RATE_REGEX)

  if (!profitMatch || profitMatch.index === undefined) {
    return null
  }

  const profitRate = profitMatch[0]
  const beforeProfit = normalized.slice(0, profitMatch.index).trim()
  const afterProfit = normalized.slice(profitMatch.index + profitRate.length).trim()
  const amountMatch = afterProfit.match(AMOUNT_PREFIX_REGEX)

  if (!beforeProfit || !amountMatch?.[1]) {
    return null
  }

  const quantityMatches = Array.from(beforeProfit.matchAll(QUANTITY_REGEX))
  const quantityMatch = quantityMatches.at(-1)

  if (!quantityMatch || quantityMatch.index === undefined) {
    return null
  }

  const quantity = quantityMatch[0].trim()
  const name = beforeProfit.slice(0, quantityMatch.index).trim()
  const evaluationAmount = amountMatch[1].trim()

  if (!name || !quantity || !profitRate || !evaluationAmount) {
    return null
  }

  return {
    name,
    quantity,
    profitRate,
    evaluationAmount,
    averagePrice: '',
    code: '',
    ticker: '',
  }
}

export function parseAppleVisionOcrText(text: string): OcrRow[] {
  const rows = text
    .split(/\r?\n/)
    .map(parseLineToRow)
    .filter((row): row is OcrRow => row !== null)

  return sanitizeOcrRows(rows)
}

export async function extractAppleVisionOcrRows(imageDataUrl: string, fileName: string) {
  const parsed = parseImageDataUrl(imageDataUrl)
  const tempDir = await mkdtemp(join(tmpdir(), 'jaroo-ocr-'))
  const tempFilePath = join(tempDir, `${fileName || 'screenshot'}.${parsed.extension}`)

  try {
    await writeFile(tempFilePath, parsed.buffer)
    const { stdout } = await execFileAsync('swift', [APPLE_VISION_SCRIPT_PATH, tempFilePath], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 8,
    })
    const rows = parseAppleVisionOcrText(stdout)

    if (rows.length > 0) {
      return rows
    }

    const imageBuffer = await readFile(tempFilePath)
    const isSvg = parsed.mimeType.toLowerCase() === 'image/svg+xml'

    if (isSvg || imageBuffer.length > 0) {
      return []
    }

    throw new Error('Apple Vision OCR returned no readable text.')
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Apple Vision OCR failed.')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

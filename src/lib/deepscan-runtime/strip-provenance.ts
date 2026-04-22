import type { RuntimeFact } from './dump-contract'

const PROVENANCE_NOTE_PATTERNS = [
  /endpoint/i,
  /json[_-]?path/i,
  /request[_-]?path/i,
  /snapshot/i,
  /\/api\//i,
  /^\$\./,
  /decoded by current/i,
]

function isDebugSource(value: unknown) {
  return Boolean(
    value
    && typeof value === 'object'
    && 'sourceAlias' in (value as Record<string, unknown>)
    && 'rawFile' in (value as Record<string, unknown>)
    && 'requestPath' in (value as Record<string, unknown>)
    && 'selector' in (value as Record<string, unknown>),
  )
}

function sanitizeNotes(notes: unknown) {
  if (!Array.isArray(notes)) {
    return undefined
  }

  const kept = notes.filter((note): note is string => (
    typeof note === 'string'
    && note.trim().length > 0
    && !PROVENANCE_NOTE_PATTERNS.some((pattern) => pattern.test(note))
  ))

  return kept.length > 0 ? kept : undefined
}

export function stripProvenance<T>(input: T): T extends object ? unknown : T {
  if (Array.isArray(input)) {
    return input.map((item) => stripProvenance(item)) as T extends object ? unknown : T
  }

  if (!input || typeof input !== 'object') {
    return input as T extends object ? unknown : T
  }

  const record = input as Record<string, unknown>
  const output: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === 'decodeMeta' || key.endsWith('DebugOnly')) {
      continue
    }

    if ((key === 'source' && isDebugSource(value)) || key === 'sourceRefs') {
      continue
    }

    if (key === 'notes') {
      const notes = sanitizeNotes(value)
      if (notes) {
        output[key] = notes
      }
      continue
    }

    output[key] = stripProvenance(value)
  }

  return output as T extends object ? unknown : T
}

export function toRuntimeFact<T>(fact: Record<string, unknown>): RuntimeFact<T> {
  return stripProvenance(fact) as RuntimeFact<T>
}

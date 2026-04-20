import type { DebugFact, DebugManifest, DebugSource, DumpIssue, DumpQuality, RuntimeFact, SeriesPoint } from './dump-contract'
import { stripProvenance } from './strip-provenance'

export function createDebugSource(source: DebugSource): DebugSource {
  return { ...source }
}

export function createDumpIssue(issue: DumpIssue): DumpIssue {
  return {
    ...issue,
    ...(issue.reasonCode ? { reasonCode: [...issue.reasonCode] } : {}),
  }
}

export function mapCellRecordToSeries(cells: Record<string, unknown>, normalizePeriod: (rawKey: string) => Pick<SeriesPoint, 'periodEnd' | 'sequence'>): SeriesPoint[] {
  return Object.entries(cells)
    .map(([sourcePeriodKey, value]) => {
      const numericValue = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(numericValue)) {
        return null
      }
      const normalized = normalizePeriod(sourcePeriodKey)
      return {
        sourcePeriodKey,
        periodEnd: normalized.periodEnd,
        ...(typeof normalized.sequence === 'number' ? { sequence: normalized.sequence } : {}),
        value: numericValue,
      } satisfies SeriesPoint
    })
    .filter((item): item is SeriesPoint => item !== null)
}

export function createDebugFact<T>(value: T, source: DebugFact<T>['source'], options: { quality?: DumpQuality; issues?: DumpIssue[]; notes?: string[] } = {}): DebugFact<T> {
  return {
    value,
    source,
    ...(options.quality ? { quality: options.quality } : {}),
    ...(options.issues && options.issues.length > 0 ? { issues: options.issues } : {}),
    ...(options.notes && options.notes.length > 0 ? { notes: options.notes } : {}),
  }
}

export function toRuntimeDump<T>(debugDump: T): T extends object ? unknown : RuntimeFact {
  return stripProvenance(debugDump) as T extends object ? unknown : RuntimeFact
}

export function createDebugManifest(input: Omit<DebugManifest, 'errors'> & { errors?: DebugManifest['errors'] }): DebugManifest {
  return {
    ...input,
    errors: input.errors ?? [],
  }
}

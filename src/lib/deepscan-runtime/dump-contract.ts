export type DumpAvailability = 'present' | 'missing' | 'unavailable'
export type DumpDerivationKind = 'direct' | 'proxy' | 'decoded_alias' | 'derived'
export type DumpInputOrigin = 'source' | 'runtime_input'
export type DumpIssueSeverity = 'low' | 'medium' | 'high'
export type DumpIssueActionability = 'usable' | 'caution' | 'do_not_use'

export type DumpQuality = {
  availability: DumpAvailability
  derivationKind?: DumpDerivationKind
  inputOrigin?: DumpInputOrigin
  reasonCode?: string[]
  severity?: DumpIssueSeverity
  actionability?: DumpIssueActionability
}

export type DumpIssue = {
  fieldRef: string
  availability: Exclude<DumpAvailability, 'present'>
  derivationKind?: DumpDerivationKind
  inputOrigin?: DumpInputOrigin
  reasonCode?: string[]
  severity?: DumpIssueSeverity
  actionability?: DumpIssueActionability
  message?: string
}

export type DebugSourceSelector =
  | { kind: 'field'; path: string }
  | { kind: 'table_row'; path: string; rowLabel: string }
  | { kind: 'series_map'; path: string }
  | { kind: 'slice'; path: string; start?: number; end?: number }
  | { kind: 'derived'; note: string }
  | { kind: 'runtime_input'; path: string }

export type DebugSource = {
  sourceAlias: 'slim' | 'quotes' | 'financials' | 'consensus' | 'news' | 'market' | 'report' | 'runtime-input'
  rawFile: string
  requestPath: string
  selector: DebugSourceSelector
  snapshotGeneratedAt?: string
  note?: string
}

export type DebugFact<T = unknown> = {
  value: T
  source: DebugSource
  quality?: DumpQuality
  issues?: DumpIssue[]
  notes?: string[]
}

export type RuntimeFact<T = unknown> = {
  value: T
  quality?: DumpQuality
  issues?: DumpIssue[]
  notes?: string[]
}

export type DebugManifest = {
  requestId: string
  debugId?: string
  generatedAt: string
  contractVersion: string
  instrument: {
    name?: string
    ticker?: string
    code?: string
    market?: string
  }
  sourceAliases: Record<string, { rawFile: string; requestPath: string }>
  memberKeys?: string[]
  sharedDebugPath?: string
  memberDebugPaths?: Record<string, string>
  callOrder?: string[]
  processedFiles: string[]
  stripProfileVersion: string
  callUnits: Array<{ member: string; sharedFile: string; memberFile: string }>
  errors: Array<{ stage: string; memberKey?: string; message: string }>
  runtimeShapeHash?: string
  runtimeSnapshotPath?: string
  axisDebugPaths?: Record<string, string>
}

export type SeriesPoint = {
  sourcePeriodKey: string
  periodEnd: string
  granularity?: 'annual' | 'quarterly' | 'mixed' | 'unknown'
  sequence?: number
  value: number
}

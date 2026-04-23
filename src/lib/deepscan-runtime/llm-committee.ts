import type { DeepScanRawInputForDump } from './us-dump-contract-runtime'
import { generateUsDumpContractArtifacts } from './us-dump-contract-runtime'
import { scoreCommitteeMember, scoreCommitteeMembers } from '../../../packages/deepscan-runtime-core/src/committee-llm.js'

export const US_MEMBER_KEYS = [
  'valuation',
  'growth',
  'profitability-quality',
  'momentum',
  'estimate-revision',
  'event-risk',
  'financial-safety',
  'ownership-flow',
  'portfolio-fit',
] as const

export type UsMemberKey = (typeof US_MEMBER_KEYS)[number]

export type CommitteeLlmVerdict = {
  score: number
  reason: string
  confidence: 'low' | 'medium' | 'high'
  warnings?: string[]
}

export type CommitteeMemberError = {
  member: UsMemberKey
  error: string
}

const COMMITTEE_SCHEMA = {
  name: 'jaroo_us_committee_member',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 100 },
      reason: { type: 'string', minLength: 1, maxLength: 400 },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['score', 'reason', 'confidence'],
  },
} as const

const MEMBER_PROMPTS: Record<UsMemberKey, { role: string; focus: string }> = {
  valuation: {
    role: 'Valuation analyst',
    focus: 'Judge valuation attractiveness from price, valuation multiples, consensus target context, and missing-data warnings.',
  },
  growth: {
    role: 'Growth analyst',
    focus: 'Judge growth quality from revenue, operating income, net income progression, and forecast/revision signals.',
  },
  'profitability-quality': {
    role: 'Profitability analyst',
    focus: 'Judge profitability quality from margin and ROE-like evidence, penalizing fragile or incomplete evidence.',
  },
  momentum: {
    role: 'Momentum analyst',
    focus: 'Judge market timing from recent returns, current-vs-latest-close context, and market regime evidence.',
  },
  'estimate-revision': {
    role: 'Estimate revision analyst',
    focus: 'Judge revision momentum from consensus spot, forecast values, and revision percentages.',
  },
  'event-risk': {
    role: 'Event scanner',
    focus: 'Judge event catalyst or event risk from recent news, earnings/recommendation coverage, and target range context.',
  },
  'financial-safety': {
    role: 'Financial safety analyst',
    focus: 'Judge balance-sheet and cash-flow resilience from assets, equity, cash flow, capex, free cash flow, and ROE context.',
  },
  'ownership-flow': {
    role: 'Ownership and flow analyst',
    focus: 'Judge ownership/flow quality carefully, explicitly downgrading confidence when only proxy peer context is available.',
  },
  'portfolio-fit': {
    role: 'Position fit analyst',
    focus: 'Judge fit for the current position from holding context, current price, market-cap context, and medium-term return context.',
  },
}

function systemPromptForMember(member: UsMemberKey) {
  const prompt = MEMBER_PROMPTS[member]
  return [
    `You are Jaroo US DeepScan committee member: ${prompt.role}.`,
    prompt.focus,
    'Use only the provided shared/member JSON generated from the frozen llm-deepscan-us-dump-contract contract.',
    'Respect quality/issues metadata. Missing or unavailable facts must lower confidence and can lower the score.',
    'Return only valid JSON matching the schema. Write the reason in concise Korean.',
    'Score semantics: 0 extremely negative, 50 mixed/unclear, 100 extremely positive. Warnings are optional short Korean caveats.',
  ].join(' ')
}

export async function scoreUsCommitteeMember(
  member: UsMemberKey,
  dumps: { shared: unknown; memberDump: unknown },
): Promise<CommitteeLlmVerdict> {
  return scoreCommitteeMember(member, dumps, {
    schemaName: COMMITTEE_SCHEMA.name,
    title: 'jaroo-mvp-v3 DeepScan Committee',
    systemPrompt: (memberKey: string) => systemPromptForMember(memberKey as UsMemberKey),
  }) as Promise<CommitteeLlmVerdict>
}

export async function scoreUsCommitteeFromGeneratedDump(rawInput: DeepScanRawInputForDump, ticker: string) {
  const totalT0 = Date.now()
  const artifacts = await generateUsDumpContractArtifacts(rawInput, ticker)
  const dumpElapsed = Date.now() - totalT0
  const shared = artifacts.runtimeShape.shared
  const members = artifacts.runtimeShape.members as Record<UsMemberKey, unknown>

  const { results, errors } = await scoreCommitteeMembers({
    memberKeys: [...US_MEMBER_KEYS],
    shared,
    members,
    options: {
      schemaName: COMMITTEE_SCHEMA.name,
      title: 'jaroo-mvp-v3 DeepScan Committee',
      systemPrompt: (memberKey: string) => systemPromptForMember(memberKey as UsMemberKey),
      summaryKey: ticker,
    },
  }) as { results: Partial<Record<UsMemberKey, CommitteeLlmVerdict>>; errors: CommitteeMemberError[] }

  const totalElapsed = Date.now() - totalT0

  return {
    artifacts,
    results,
    errors,
  }
}

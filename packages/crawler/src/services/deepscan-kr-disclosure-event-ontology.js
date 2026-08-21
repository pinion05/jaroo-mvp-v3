import { createHash } from 'node:crypto';

export const KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION = 'jaroo.kr-disclosure-event-ontology.v1';

export const CANONICAL_DISCLOSURE_EVENT_FIELDS = Object.freeze([
  'type',
  'action',
  'state',
  'cause',
  'subjectType',
]);

function frozenSorted(values) {
  return Object.freeze([...new Set(values)].sort());
}

// These enums are the wire vocabulary. Null remains meaningful for every field except type:
// it means that the source did not establish that dimension, not an inferred default.
export const KR_DISCLOSURE_EVENT_ENUMS = Object.freeze({
  type: frozenSorted([
    'asset-transaction', 'audit', 'capital-change', 'capital-expenditure', 'corporate-action',
    'corporate-event', 'corporate-profile', 'disclosure-inquiry', 'earnings', 'governance',
    'insolvency', 'legal-regulatory', 'material-contract', 'operating-performance',
    'operating-status', 'other', 'ownership-change', 'periodic-report', 'regulatory-product',
    'related-party', 'restructuring', 'supplier-payment', 'sustainability', 'trading-status',
  ]),
  action: frozenSorted([
    'acquired', 'adjusted', 'announced', 'appealed', 'applied', 'appointed', 'approved',
    'assumed', 'borrowed', 'cancelled', 'changed', 'completed', 'confirmed', 'contracted',
    'convened', 'decided', 'defaulted', 'dismissed',
    'delisting-triggered', 'deposited', 'designated', 'designation-lifted', 'disposed',
    'dissolved', 'donated', 'established', 'exercised', 'extended', 'filed', 'forecasted', 'granted',
    'guaranteed', 'halted', 'held', 'initiated', 'invested', 'leased-in', 'leased-out',
    'lent', 'lifted', 'listed', 'name-changed', 'not-designated', 'occurred', 'opinion-filed',
    'imposed', 'milestone-earned', 'ordered', 'period-ended', 'planned', 'price-set',
    'provided', 'published', 'purchased', 'received', 'repaid', 'reported',
    'rescheduled', 'responded', 'resumed', 'sanctioned', 'scheduled', 'scope-changed',
    'selected', 'sold', 'solicited', 'submitted', 'terminated', 'triggered', 'unchanged',
    'under-review', 'updated', 'warned', 'withdrawn',
  ]),
  state: frozenSorted([
    'active', 'alleged', 'cancelled', 'corrected', 'correction-requested', 'deferred', 'effective',
    'finalized', 'lifted', 'pending', 'preliminary', 'projected', 'proposed',
    'screening-pending', 'uncertain',
  ]),
  cause: frozenSorted([
    'accounting-violation', 'affiliate-equity-investment', 'affiliate-financial-transactions',
    'affiliate-share-disposal', 'aircraft-lease', 'annual-report', 'annual-report-deadline',
    'asset-acquisition', 'asset-custody-contract', 'asset-disposal', 'asset-management-contract',
    'asset-transfer',
    'audit-opinion', 'audit-report', 'board-committee', 'bond-default', 'bond-purchase',
    'bond-sale', 'bond-transactions', 'bond-with-warrants', 'bonus-issue', 'brand-license-fee',
    'business-acquisition', 'business-disposal', 'business-group-status', 'business-plan',
    'business-reorganization', 'business-suspension', 'business-transfer', 'capital-reduction',
    'capital-strengthening',
    'cash-dividend', 'cash-donation', 'chief-executive-change', 'collateral-provision',
    'collateral-received', 'commercial-paper-transactions', 'company-name-change',
    'compliance-program', 'construction-project', 'construction-right-acquisition',
    'contingent-capital-securities', 'contract-right', 'control-sale', 'controlling-shareholder',
    'convertible-bond', 'convertible-bond-acquisition', 'convertible-bond-call-option',
    'convertible-bond-conversion', 'convertible-price', 'corporate-governance-report',
    'creditor-bank-management', 'debt-assumption', 'debt-guarantee', 'debt-securities',
    'delisting', 'delisting-review', 'demerger', 'deposit-investment',
    'deposit-product-transactions', 'derivative-linked-securities', 'derivative-securities',
    'derivative-swap-transactions',
    'disclaimer-of-opinion', 'disclosure-compliance', 'disclosure-correction', 'dissolution',
    'dividend-policy', 'earnings-guidance', 'earnings-release', 'embezzlement-breach-of-trust',
    'employee-welfare-fund-contribution', 'equity-acquisition', 'equity-disposal',
    'equity-linked-bond', 'equity-linked-securities', 'equity-securities', 'equity-transactions',
    'exchangeable-bond',
    'exchangeable-bond-exchange', 'external-auditor', 'facility-investment', 'fda-approval',
    'fda-crl', 'financing', 'fund-investment', 'fund-securities', 'fund-security-investment',
    'fund-security-transactions', 'insider-holdings', 'insider-ownership',
    'insider-trading-plan', 'insurance-transaction', 'intellectual-property',
    'internal-goods-services', 'internal-lease', 'internal-transaction', 'investor-caution',
    'investor-relations', 'large-shareholding', 'licensing-milestone', 'listing-eligibility',
    'listing-improvement-period', 'litigation', 'loan', 'lockup', 'major-shareholder',
    'market-movement-inquiry', 'material-disclosure', 'merger', 'merger-or-reorganization',
    'milestone-earned', 'mmf-purchase', 'nxt-trading', 'operating-results',
    'other-securities-transactions', 'outside-director',
    'overseas-listing', 'patent', 'payment-default', 'product-approval', 'production-suspension',
    'proxy-solicitation', 'quarterly-report', 'real-estate-lease', 'real-estate-purchase',
    'real-estate-sale', 'record-date', 'regulatory-fine', 'regulatory-work-stop',
    'rehabilitation',
    'related-party-borrowing', 'related-party-contract-right-updated',
    'related-party-contract-updated', 'related-party-lending',
    'related-party-loan', 'related-party-real-estate-leased-in',
    'related-party-real-estate-leased-out', 'research-license-agreement',
    'retirement-pension', 'retirement-pension-transactions', 'rights-offering',
    'rights-offering-participation', 'rumor-inquiry', 'sales-volume', 'securities-borrowing',
    'securities-donation', 'securities-issuance', 'securities-offering', 'securities-purchase',
    'securities-sale', 'semiannual-report', 'serious-industrial-accident',
    'serious-industrial-accident-penalty', 'service-contract', 'share-cancellation',
    'share-consolidation-or-split', 'share-exchange', 'shareholder-meeting',
    'shareholder-return-policy', 'shelf-registration', 'short-term-debt-issuance-limit',
    'short-term-borrowing', 'split-merger', 'stock-option', 'subcontract-payment-terms',
    'subsidiary-entry', 'subsidiary-exit', 'subsidiary-inclusion', 'supply-contract',
    'sustainability-report', 'tangible-asset-acquisition',
    'tangible-asset-disposal', 'technology-transfer', 'tender-offer', 'treasury-share',
    'treasury-share-acquisition', 'treasury-share-disposal', 'treasury-share-trust',
    'value-up-plan', 'voluntary-liquidation', 'warrant-bond', 'warrant-bond-sale', 'work-stop',
  ]),
  subjectType: frozenSorted([
    'asset', 'asset-transfer', 'audit-opinion', 'auditor', 'business', 'cash', 'contract',
    'contract-right', 'debt-guarantee', 'financials', 'governance', 'intellectual-property',
    'issuer', 'listed-shares', 'operating-business', 'operations', 'ownership', 'product',
    'real-estate', 'securities', 'subsidiary',
  ]),
});

const ALIAS_RULES = Object.freeze([
  Object.freeze({ type: 'earnings', field: 'action', from: 'published', to: 'announced' }),
  Object.freeze({ type: 'earnings', field: 'cause', from: 'earnings-release', to: 'operating-results' }),
  Object.freeze({ type: 'earnings', field: 'cause', from: 'earnings-announcement', to: 'operating-results' }),
  Object.freeze({ type: 'earnings', field: 'cause', from: 'results-announcement', to: 'operating-results' }),
  Object.freeze({ type: 'capital-change', field: 'cause', from: 'conditional-capital-security', to: 'contingent-capital-securities' }),
  Object.freeze({ type: 'material-contract', field: 'cause', from: 'construction-contract', to: 'construction-project' }),
  Object.freeze({ type: 'disclosure-inquiry', field: 'cause', from: 'media-rumor', to: 'rumor-inquiry' }),
  Object.freeze({ type: 'disclosure-inquiry', field: 'cause', from: 'rumour-inquiry', to: 'rumor-inquiry' }),
  Object.freeze({ type: 'related-party', field: 'cause', from: 'affiliate-investment', to: 'affiliate-equity-investment' }),
  Object.freeze({ type: 'supplier-payment', field: 'cause', from: 'payment-practices', to: 'subcontract-payment-terms' }),
  Object.freeze({ type: 'trading-status', field: 'cause', from: 'rumour-inquiry', to: 'rumor-inquiry' }),
]);

const ALIAS_BY_CONTEXT = new Map(
  ALIAS_RULES.map((rule) => [`${rule.type}\u0000${rule.field}\u0000${rule.from}`, rule.to]),
);

export const KR_DISCLOSURE_EVENT_STATE_SEMANTICS = Object.freeze({
  null: 'The source does not establish a lifecycle state; no default may be inferred.',
  active: 'The status or obligation remains in force without implying its original start date.',
  proposed: 'A decision or plan exists but has not become operative.',
  pending: 'Execution, effectiveness, review, or a scheduled occurrence is still outstanding.',
  preliminary: 'Reported measurement is explicitly provisional and may be revised.',
  projected: 'Forward-looking value or outcome rather than an observed result.',
  effective: 'The event or legal/operational effect is currently operative or completed.',
  deferred: 'The expected transition has been postponed.',
  cancelled: 'The proposed or pending event has been voided.',
  lifted: 'A restriction or status has ended.',
  alleged: 'An allegation is reported without adjudicating it as established fact.',
  uncertain: 'The issuer response explicitly leaves the underlying fact unresolved.',
  'screening-pending': 'A screening trigger occurred, but the screening decision is outstanding.',
  corrected: 'A filing corrects prior disclosure; it does not by itself create another business event.',
  'correction-requested': 'The authority requested correction; substantive event state is not inferred.',
  finalized: 'Previously variable filing terms are fixed; this is not a duplicate occurrence.',
});

export const KR_DISCLOSURE_EVENT_CORRECTION_SEMANTICS = Object.freeze({
  identity: 'Corrections update the same disclosed occurrence unless the document establishes an independent occurrence.',
  state: 'Correction wrapper state and substantive event lifecycle state must not be conflated.',
  cardinality: 'Canonicalization never sorts, merges, or deduplicates events; repeated tuples may represent distinct occurrences.',
  nulls: 'Corrections must preserve null when the corrected document still does not establish a field.',
});

function frozenCanonicalEvent(type, action, state, cause, subjectType) {
  return Object.freeze({ type, action, state, cause, subjectType });
}

// These are labeling contracts, not title-only extraction rules. They freeze
// adjudication boundaries that proved ambiguous in the first burned cohort so
// a future prediction-blinded holdout cannot silently redefine the gold labels.
export const KR_DISCLOSURE_EVENT_TEMPLATE_SEMANTICS = Object.freeze([
  Object.freeze({
    family: 'maximum-shareholder-ownership-change',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('ownership-change', 'reported', 'effective', 'large-shareholding', 'ownership'),
    ]),
    rationale: 'The form reports the aggregate maximum-shareholder group; individual insider rows do not change the document-level family.',
  }),
  Object.freeze({
    family: 'corrected-business-group-status',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('governance', 'updated', 'effective', 'business-group-status', 'governance'),
    ]),
    rationale: 'A substantive correction updates the existing group-status disclosure and is effective when filed.',
  }),
  Object.freeze({
    family: 'preliminary-operating-results',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('earnings', 'announced', 'preliminary', 'operating-results', 'financials'),
    ]),
    rationale: 'Announced is the canonical action; published is a contextual alias for this earnings family.',
  }),
  Object.freeze({
    family: 'holding-company-subsidiary-inclusion',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('corporate-profile', 'changed', 'effective', 'subsidiary-inclusion', 'subsidiary'),
    ]),
    rationale: 'The filing reports the effective change in subsidiary scope; a share acquisition may be the mechanism but not the document-level action.',
  }),
  Object.freeze({
    family: 'shareholder-meeting-notice',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('governance', 'convened', 'pending', 'shareholder-meeting', 'governance'),
    ]),
    rationale: 'The meeting has been formally called while the meeting occurrence remains pending.',
  }),
  Object.freeze({
    family: 'issued-regulatory-work-stop',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('operating-status', 'halted', 'active', 'work-stop', 'operating-business'),
    ]),
    rationale: 'An issued order is an active operating restriction until the source establishes cancellation or lifting.',
  }),
  Object.freeze({
    family: 'related-party-equity-contribution',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('related-party', 'decided', 'proposed', 'affiliate-equity-investment', 'securities'),
    ]),
    rationale: 'A board-approved future subscription is a proposed securities contribution, regardless of missing provider detail metadata.',
  }),
  Object.freeze({
    family: 'future-supply-contract',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('material-contract', 'contracted', 'pending', 'supply-contract', 'contract'),
    ]),
    rationale: 'A future operative start or future contract-signing date keeps the disclosed contract lifecycle pending.',
  }),
  Object.freeze({
    family: 'active-supply-contract-extension',
    canonicalEvents: Object.freeze([
      frozenCanonicalEvent('material-contract', 'extended', 'effective', 'supply-contract', 'contract'),
    ]),
    rationale: 'A signed amendment extending an already active contract is effective even when the revised end date lies in the future.',
  }),
]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const KR_DISCLOSURE_EVENT_ONTOLOGY_MANIFEST = Object.freeze({
  version: KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
  fields: CANONICAL_DISCLOSURE_EVENT_FIELDS,
  enums: KR_DISCLOSURE_EVENT_ENUMS,
  stateSemantics: KR_DISCLOSURE_EVENT_STATE_SEMANTICS,
  correctionSemantics: KR_DISCLOSURE_EVENT_CORRECTION_SEMANTICS,
  templateSemantics: KR_DISCLOSURE_EVENT_TEMPLATE_SEMANTICS,
  aliases: ALIAS_RULES,
  invariants: Object.freeze([
    'An event has exactly five own enumerable keys.',
    'type is required and type=other is an abstention, not a valid canonical event.',
    'action, state, cause, and subjectType may be null and null is preserved.',
    'Event array order and duplicate cardinality are preserved by canonicalization.',
  ]),
});

export const KR_DISCLOSURE_EVENT_ONTOLOGY_HASH = createHash('sha256')
  .update(stableJson(KR_DISCLOSURE_EVENT_ONTOLOGY_MANIFEST))
  .digest('hex');

const ALLOWED_BY_FIELD = Object.freeze(Object.fromEntries(
  Object.entries(KR_DISCLOSURE_EVENT_ENUMS).map(([field, values]) => [field, new Set(values)]),
));

export function validateCanonicalDisclosureEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['event must be a non-array object']) });
  }

  const keys = Object.keys(event);
  const expected = new Set(CANONICAL_DISCLOSURE_EVENT_FIELDS);
  for (const field of CANONICAL_DISCLOSURE_EVENT_FIELDS) {
    if (!Object.hasOwn(event, field)) errors.push(`missing field: ${field}`);
  }
  for (const key of keys) {
    if (!expected.has(key)) errors.push(`unknown field: ${key}`);
  }

  for (const field of CANONICAL_DISCLOSURE_EVENT_FIELDS) {
    if (!Object.hasOwn(event, field)) continue;
    const value = event[field];
    if (field !== 'type' && value === null) continue;
    if (typeof value !== 'string' || !ALLOWED_BY_FIELD[field].has(value)) {
      errors.push(`unknown ${field}: ${String(value)}`);
    }
  }
  if (event.type === 'other') errors.push('type=other is not a resolved canonical event');

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertCanonicalDisclosureEvent(event) {
  const validation = validateCanonicalDisclosureEvent(event);
  if (!validation.valid) throw new TypeError(`Invalid canonical disclosure event: ${validation.errors.join('; ')}`);
  return event;
}

export function canonicalizeDisclosureEventAliases(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return assertCanonicalDisclosureEvent(event);
  }
  const keys = Object.keys(event);
  if (keys.length !== CANONICAL_DISCLOSURE_EVENT_FIELDS.length
    || keys.some((key) => !CANONICAL_DISCLOSURE_EVENT_FIELDS.includes(key))) {
    return assertCanonicalDisclosureEvent(event);
  }
  const canonical = Object.fromEntries(CANONICAL_DISCLOSURE_EVENT_FIELDS.map((field) => {
    const value = event[field];
    const alias = typeof value === 'string'
      ? ALIAS_BY_CONTEXT.get(`${event.type}\u0000${field}\u0000${value}`)
      : undefined;
    return [field, alias ?? value];
  }));
  assertCanonicalDisclosureEvent(canonical);
  return canonical;
}

export function canonicalizeDisclosureEventList(events) {
  if (!Array.isArray(events)) throw new TypeError('Canonical disclosure events must be an array');
  return events.map(canonicalizeDisclosureEventAliases);
}

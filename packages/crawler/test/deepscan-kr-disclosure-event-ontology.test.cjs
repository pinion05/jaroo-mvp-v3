const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const path = require('node:path');

const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../src/services/deepscan-kr-disclosure-event-ontology.js',
)).href;

let ontology;

test.before(async () => {
  ontology = await import(moduleUrl);
});

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function event(overrides = {}) {
  return {
    type: 'capital-change',
    action: 'decided',
    state: 'proposed',
    cause: 'rights-offering',
    subjectType: 'securities',
    ...overrides,
  };
}

test('manifest hash is deterministic, content-addressed, and versioned', () => {
  const expected = createHash('sha256')
    .update(stableJson(ontology.KR_DISCLOSURE_EVENT_ONTOLOGY_MANIFEST))
    .digest('hex');
  assert.equal(ontology.KR_DISCLOSURE_EVENT_ONTOLOGY_HASH, expected);
  assert.match(expected, /^[a-f0-9]{64}$/u);
  assert.equal(
    ontology.KR_DISCLOSURE_EVENT_ONTOLOGY_MANIFEST.version,
    ontology.KR_DISCLOSURE_EVENT_ONTOLOGY_VERSION,
  );
  assert.deepEqual(ontology.CANONICAL_DISCLOSURE_EVENT_FIELDS, [
    'type', 'action', 'state', 'cause', 'subjectType',
  ]);
});

test('known tuples emitted by current extractors validate', () => {
  const tuples = [
    event(),
    event({ type: 'earnings', action: 'announced', state: 'preliminary', cause: 'operating-results', subjectType: 'financials' }),
    event({ type: 'disclosure-inquiry', action: 'responded', state: 'uncertain', cause: 'rumor-inquiry', subjectType: 'issuer' }),
    event({ type: 'operating-status', action: 'resumed', state: 'effective', cause: 'production-suspension', subjectType: 'business' }),
    event({ type: 'legal-regulatory', action: 'scheduled', state: 'pending', cause: 'compliance-program', subjectType: 'issuer' }),
    event({ type: 'legal-regulatory', action: 'appealed', state: 'active', cause: 'patent', subjectType: 'intellectual-property' }),
    event({ type: 'restructuring', action: 'approved', state: 'effective', cause: 'business-reorganization', subjectType: 'business' }),
    event({ type: 'regulatory-product', action: 'filed', state: 'pending', cause: 'derivative-linked-securities', subjectType: 'product' }),
    event({ type: 'regulatory-product', action: 'filed', state: 'pending', cause: 'equity-linked-securities', subjectType: 'product' }),
    event({ type: 'capital-change', action: 'decided', state: 'proposed', cause: 'short-term-borrowing', subjectType: 'subsidiary' }),
    event({ type: 'corporate-profile', action: 'changed', state: 'effective', cause: 'subsidiary-inclusion', subjectType: 'subsidiary' }),
    event({ type: 'material-contract', action: 'lent', state: 'effective', cause: 'loan', subjectType: 'contract' }),
    event({ type: 'related-party', action: 'reported', state: 'effective', cause: 'other-securities-transactions', subjectType: 'securities' }),
  ];
  for (const tuple of tuples) assert.deepEqual(ontology.validateCanonicalDisclosureEvent(tuple), { valid: true, errors: [] });
});

test('template semantics freeze adjudication decisions for previously ambiguous families', () => {
  const semantics = ontology.KR_DISCLOSURE_EVENT_TEMPLATE_SEMANTICS;
  assert.ok(Array.isArray(semantics));
  assert.ok(semantics.length >= 8);
  const byFamily = new Map(semantics.map((item) => [item.family, item]));
  assert.deepEqual(byFamily.get('maximum-shareholder-ownership-change').canonicalEvents, [
    event({
      type: 'ownership-change', action: 'reported', state: 'effective',
      cause: 'large-shareholding', subjectType: 'ownership',
    }),
  ]);
  assert.deepEqual(byFamily.get('issued-regulatory-work-stop').canonicalEvents, [
    event({
      type: 'operating-status', action: 'halted', state: 'active',
      cause: 'work-stop', subjectType: 'operating-business',
    }),
  ]);
  assert.ok(Object.isFrozen(semantics));
  assert.ok(Object.isFrozen(byFamily.get('preliminary-operating-results')));
});

test('strict validation rejects unknown values, type other, missing fields, and extra keys', () => {
  assert.equal(ontology.validateCanonicalDisclosureEvent(event({ action: 'invented' })).valid, false);
  assert.equal(ontology.validateCanonicalDisclosureEvent(event({ type: 'other' })).valid, false);
  const missing = event();
  delete missing.state;
  assert.match(ontology.validateCanonicalDisclosureEvent(missing).errors.join(' '), /missing field: state/u);
  assert.match(ontology.validateCanonicalDisclosureEvent({ ...event(), confidence: 'high' }).errors.join(' '), /unknown field: confidence/u);
  assert.throws(() => ontology.assertCanonicalDisclosureEvent(event({ cause: 'unknown-cause' })), TypeError);
  assert.throws(() => ontology.canonicalizeDisclosureEventAliases({ ...event(), confidence: 'high' }), /unknown field/u);
});

test('contextual aliases canonicalize exact vocabulary only', () => {
  assert.deepEqual(
    ontology.canonicalizeDisclosureEventAliases(event({
      type: 'earnings', action: 'announced', state: null,
      cause: 'earnings-announcement', subjectType: 'financials',
    })),
    event({ type: 'earnings', action: 'announced', state: null, cause: 'operating-results', subjectType: 'financials' }),
  );
  assert.deepEqual(
    ontology.canonicalizeDisclosureEventAliases(event({
      type: 'earnings', action: 'scheduled', state: 'pending',
      cause: 'earnings-release', subjectType: 'financials',
    })),
    event({ type: 'earnings', action: 'scheduled', state: 'pending', cause: 'operating-results', subjectType: 'financials' }),
  );
  assert.deepEqual(
    ontology.canonicalizeDisclosureEventAliases(event({
      type: 'earnings', action: 'published', state: 'preliminary',
      cause: 'operating-results', subjectType: 'financials',
    })),
    event({ type: 'earnings', action: 'announced', state: 'preliminary', cause: 'operating-results', subjectType: 'financials' }),
  );
  assert.deepEqual(
    ontology.canonicalizeDisclosureEventAliases(event({
      type: 'disclosure-inquiry', action: 'responded', state: null,
      cause: 'rumour-inquiry', subjectType: 'issuer',
    })),
    event({ type: 'disclosure-inquiry', action: 'responded', state: null, cause: 'rumor-inquiry', subjectType: 'issuer' }),
  );
  assert.deepEqual(
    ontology.canonicalizeDisclosureEventAliases(event({ cause: 'conditional-capital-security' })),
    event({ cause: 'contingent-capital-securities' }),
  );
  assert.deepEqual(
    ontology.canonicalizeDisclosureEventAliases(event({
      type: 'disclosure-inquiry', action: 'responded', state: 'uncertain',
      cause: 'media-rumor', subjectType: 'issuer',
    })),
    event({
      type: 'disclosure-inquiry', action: 'responded', state: 'uncertain',
      cause: 'rumor-inquiry', subjectType: 'issuer',
    }),
  );
});

test('canonicalization does not collapse non-alias causes or infer null state', () => {
  const input = event({
    type: 'earnings', action: 'announced', state: null,
    cause: 'operating-results', subjectType: 'financials',
  });
  assert.deepEqual(ontology.canonicalizeDisclosureEventAliases(input), input);
  assert.equal(ontology.canonicalizeDisclosureEventAliases(input).state, null);
  assert.throws(() => ontology.canonicalizeDisclosureEventAliases(event({
    type: 'capital-change', cause: 'earnings-announcement',
  })), /unknown cause/u);
});

test('list canonicalization preserves ordering and duplicate cardinality', () => {
  const duplicate = event({ state: null });
  const result = ontology.canonicalizeDisclosureEventList([duplicate, duplicate]);
  assert.equal(result.length, 2);
  assert.deepEqual(result, [duplicate, duplicate]);
  assert.notEqual(result[0], result[1]);
});

test('published enums and manifest collections are immutable', () => {
  assert.ok(Object.isFrozen(ontology.KR_DISCLOSURE_EVENT_ENUMS));
  assert.ok(Object.isFrozen(ontology.KR_DISCLOSURE_EVENT_ENUMS.cause));
  assert.ok(Object.isFrozen(ontology.KR_DISCLOSURE_EVENT_ONTOLOGY_MANIFEST));
  assert.throws(() => ontology.KR_DISCLOSURE_EVENT_ENUMS.type.push('new-type'), TypeError);
});

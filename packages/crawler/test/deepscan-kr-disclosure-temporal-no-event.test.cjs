const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const BENCHMARK = join(
  __dirname,
  '..',
  'scripts',
  'benchmark-dart-disclosure-temporal-holdout.mjs',
);

const GOLD = Object.freeze({
  type: 'capital-change',
  action: 'decided',
  state: 'proposed',
  cause: 'rights-offering',
  subjectType: 'securities',
});

function annotation(name, goldDisposition, expectedEvents) {
  return {
    annotator: name,
    blindedToPrediction: true,
    confidenceInLabel: 'high',
    goldDisposition,
    expectedEvents,
  };
}

function goldCase({
  goldDisposition = 'no-canonical-events',
  expectedEvents = [],
  decision = 'agreement',
  annotations,
} = {}) {
  const labels = annotations ?? [
    annotation('reviewer-a', goldDisposition, expectedEvents),
    annotation('reviewer-b', goldDisposition, expectedEvents),
  ];
  return {
    id: 'no-event-1',
    templateKey: '기타주요경영사항',
    source: { corpCode: '00126380' },
    goldDisposition,
    expectedEvents,
    annotations: labels,
    adjudication: {
      adjudicator: 'reviewer-c',
      decision,
      blindedToPrediction: true,
      rationale: '독립 검토 결과를 확정했습니다.',
      goldDisposition,
      expectedEvents,
    },
  };
}

test('sealed v3 gold disposition is mandatory on case, annotations, and adjudication', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  for (const mutate of [
    (value) => { delete value.goldDisposition; },
    (value) => { delete value.annotations[0].goldDisposition; },
    (value) => { delete value.adjudication.goldDisposition; },
  ]) {
    const value = structuredClone(goldCase());
    mutate(value);
    assert.throws(
      () => benchmark.validateSealedV3GoldLabels(value),
      /goldDisposition must be canonical-events-present or no-canonical-events/,
    );
  }
});

test('sealed v3 rejects disposition and expectedEvents mismatches', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  assert.throws(
    () => benchmark.validateSealedV3GoldLabels(goldCase({
      goldDisposition: 'no-canonical-events',
      expectedEvents: [GOLD],
    })),
    /expectedEvents must be empty/,
  );
  assert.throws(
    () => benchmark.validateSealedV3GoldLabels(goldCase({
      goldDisposition: 'canonical-events-present',
      expectedEvents: [],
    })),
    /expectedEvents must be nonempty/,
  );
});

test('two independent annotators can agree that no canonical event exists', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const value = goldCase();
  assert.equal(benchmark.validateSealedV3GoldLabels(value), value);
});

test('resolved adjudication accepts a disposition disagreement and fixes the final no-event gold', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const value = goldCase({
    decision: 'resolved',
    annotations: [
      annotation('reviewer-a', 'no-canonical-events', []),
      annotation('reviewer-b', 'canonical-events-present', [GOLD]),
    ],
  });
  assert.equal(benchmark.validateSealedV3GoldLabels(value), value);

  const invalid = structuredClone(value);
  invalid.annotations[1] = annotation('reviewer-b', 'no-canonical-events', []);
  assert.throws(
    () => benchmark.validateSealedV3GoldLabels(invalid),
    /resolved adjudication requires an annotation disagreement/,
  );
});

test('no-event gold remains strictly incorrect for abstention and hallucination', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const fixtureCase = goldCase();
  const abstention = benchmark.evaluateTemporalHoldoutCase(fixtureCase, {
    events: [],
    confidence: 'low',
    abstained: true,
  });
  assert.equal(abstention.exact, false);
  assert.equal(abstention.resolved, false);
  assert.equal(abstention.fieldMatches, 0);
  assert.equal(abstention.fieldDenominator, 0);

  const implicitAbstention = benchmark.evaluateTemporalHoldoutCase(fixtureCase, {
    events: [],
    confidence: 'low',
  });
  assert.equal(implicitAbstention.abstained, true);

  const hallucination = benchmark.evaluateTemporalHoldoutCase(fixtureCase, {
    events: [GOLD],
    confidence: 'high',
  });
  assert.equal(hallucination.exact, false);
  assert.equal(hallucination.resolved, true);
  assert.equal(hallucination.fieldMatches, 0);
  assert.equal(hallucination.fieldDenominator, 0);

  const explicitNoEvent = benchmark.evaluateTemporalHoldoutCase(fixtureCase, {
    events: [],
    confidence: 'low',
    disposition: 'no-canonical-events',
    resolved: true,
  });
  assert.equal(explicitNoEvent.exact, true);
  assert.equal(explicitNoEvent.resolved, true);
  assert.equal(explicitNoEvent.abstained, false);
  assert.equal(explicitNoEvent.fieldMatches, 0);
  assert.equal(explicitNoEvent.fieldDenominator, 0);

  const metrics = benchmark.assessTemporalHoldoutThresholds(
    [abstention, implicitAbstention, hallucination, explicitNoEvent],
    {},
  );
  assert.equal(metrics.metrics.noCanonicalEventCount, 4);
  assert.equal(metrics.metrics.noCanonicalEventRate, 1);
  assert.equal(metrics.metrics.abstentionCount, 2);
  assert.equal(metrics.metrics.noCanonicalEventAbstentionCount, 2);
  assert.equal(metrics.metrics.explicitNoCanonicalEventPredictionCount, 1);
  assert.equal(metrics.metrics.noCanonicalEventExactCount, 1);
  assert.equal(metrics.metrics.dispositionExactCount, 1);
  assert.equal(metrics.metrics.dispositionAccuracy, 0.25);
  assert.equal(metrics.metrics.eventFieldScoredCaseCount, 0);
  assert.equal(metrics.metrics.maximumAchievableExactCount, 4);
  assert.equal(metrics.metrics.maximumAchievableExactAccuracy, 1);
});

test('no-event disposition rejects contradictory event payloads', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  assert.throws(
    () => benchmark.evaluateTemporalHoldoutCase(goldCase(), {
      events: [GOLD],
      confidence: 'low',
      disposition: 'no-canonical-events',
    }),
    /no-canonical-events prediction.*must contain no events/,
  );
});

test('resolved dispositions require an events array', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  for (const events of [undefined, null, 'none', {}, 0]) {
    const prediction = {
      confidence: 'low',
      disposition: 'no-canonical-events',
    };
    if (events !== undefined) prediction.events = events;
    assert.throws(
      () => benchmark.evaluateTemporalHoldoutCase(goldCase(), prediction),
      /prediction events.*must be an array/,
    );
  }
});

test('positive canonical-event scoring remains unchanged', async () => {
  const benchmark = await import(pathToFileURL(BENCHMARK));
  const fixtureCase = goldCase({
    goldDisposition: 'canonical-events-present',
    expectedEvents: [GOLD],
  });
  benchmark.validateSealedV3GoldLabels(fixtureCase);
  const result = benchmark.evaluateTemporalHoldoutCase(fixtureCase, {
    events: [GOLD],
    confidence: 'high',
  });
  assert.equal(result.exact, true);
  assert.equal(result.resolved, true);
  assert.equal(result.fieldMatches, 5);
  assert.equal(result.fieldDenominator, 5);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bestAlignment,
  eventMultisetEqual,
  scoreCases,
  wilsonInterval,
} from './score-accuracy.mjs';

const ownership = {
  type: 'ownership-change',
  action: 'reported',
  state: 'effective',
  cause: 'large-shareholding',
  subjectType: 'ownership',
};
const meeting = {
  type: 'governance',
  action: 'held',
  state: 'effective',
  cause: 'shareholder-meeting',
  subjectType: 'governance',
};

test('event multiset equality ignores order but preserves duplicate cardinality', () => {
  assert.equal(eventMultisetEqual([ownership, meeting], [meeting, ownership]), true);
  assert.equal(eventMultisetEqual([ownership, ownership], [ownership]), false);
  assert.equal(eventMultisetEqual([ownership, ownership], [ownership, meeting]), false);
});

test('best alignment maximizes five-field agreement across reordered events', () => {
  const result = bestAlignment([ownership, meeting], [meeting, ownership]);
  assert.equal(result.total, 10);
  assert.deepEqual(result.fieldMatches, {
    type: 2,
    action: 2,
    state: 2,
    cause: 2,
    subjectType: 2,
  });
});

test('unmatched events count as five field mismatches', () => {
  const result = bestAlignment([ownership], [ownership, meeting]);
  assert.equal(result.total, 5);
  assert.deepEqual(result.fieldMatches, {
    type: 1,
    action: 1,
    state: 1,
    cause: 1,
    subjectType: 1,
  });
});

test('wilson interval is bounded and contains the observed proportion', () => {
  const interval = wilsonInterval(8, 10);
  assert.ok(interval.lower < 0.8);
  assert.ok(interval.upper > 0.8);
  assert.ok(interval.lower >= 0);
  assert.ok(interval.upper <= 1);
});

test('scoreCases separates conditional exact and end-to-end availability', () => {
  const sourceResults = [
    {
      source: { rceptNo: '1', corpName: 'A', reportName: '공시', disclosureDetailType: 'A001' },
      document: { bodyTruncated: false },
      eventExtraction: {
        resolved: true,
        disposition: 'canonical-events-present',
        confidence: 'high',
        events: [ownership],
      },
    },
    {
      source: { rceptNo: '2', corpName: 'B', reportName: '공시', disclosureDetailType: 'A001' },
      document: null,
      eventExtraction: null,
    },
  ];
  const goldCases = [
    { rceptNo: '1', assessable: true, goldEvents: [ownership], acceptableAlternatives: [] },
    { rceptNo: '2', assessable: false, goldEvents: null, acceptableAlternatives: [] },
  ];
  const result = scoreCases({ goldCases, sourceResults });
  assert.equal(result.summary.availableExactAccuracy, 1);
  assert.equal(result.summary.endToEndUsableAccuracy, 0.5);
  assert.equal(result.summary.unassessableFilings, 1);
});

test('predictions against an empty assessable gold count in the field denominator', () => {
  const sourceResults = [{
    source: { rceptNo: '1', corpName: 'A', reportName: '공시', disclosureDetailType: 'A001' },
    document: { bodyTruncated: false },
    eventExtraction: {
      resolved: true,
      disposition: 'canonical-events-present',
      confidence: 'high',
      events: [ownership],
    },
  }];
  const goldCases = [{
    rceptNo: '1',
    assessable: true,
    goldEvents: [],
    acceptableAlternatives: [],
  }];

  const result = scoreCases({ goldCases, sourceResults });
  assert.equal(result.fields.denominatorOccurrences, 1);
  assert.equal(result.fields.microAccuracy, 0);
  assert.equal(result.cases[0].mismatchedFields.length, 5);
});

test('acceptable alternatives do not credit unresolved predictions', () => {
  const sourceResults = [{
    source: { rceptNo: '1', corpName: 'A', reportName: '공시', disclosureDetailType: 'A001' },
    document: { bodyTruncated: false },
    eventExtraction: {
      resolved: false,
      disposition: 'canonical-events-present',
      confidence: 'low',
      events: [meeting],
    },
  }];
  const goldCases = [{
    rceptNo: '1',
    assessable: true,
    goldEvents: [ownership],
    acceptableAlternatives: [[meeting]],
  }];

  const result = scoreCases({ goldCases, sourceResults });
  assert.equal(result.summary.exactFilings, 0);
  assert.equal(result.summary.toleranceExactFilings, 0);
});

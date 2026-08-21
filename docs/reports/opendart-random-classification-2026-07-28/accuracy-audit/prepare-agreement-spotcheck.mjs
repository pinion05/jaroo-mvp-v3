import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { eventMultisetEqual } from './score-accuracy.mjs';

const here = new URL('.', import.meta.url).pathname;
const packetDir = resolve(
  process.env.ACCURACY_AUDIT_PACKET_DIR ?? '/tmp/jaroo-opendart-accuracy-audit',
);
const seed = 'jaroo-accuracy-agreement-spotcheck-v1';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const sample = [];
for (let slice = 1; slice <= 4; slice += 1) {
  const [a, b, packet] = await Promise.all([
    readJson(resolve(here, `gold-slice-${slice}.json`)),
    readJson(resolve(here, `gold-b-slice-${slice}.json`)),
    readJson(resolve(packetDir, `blind-slice-${slice}.json`)),
  ]);
  const bByReceipt = new Map(b.cases.map((entry) => [entry.rceptNo, entry]));
  const blindByReceipt = new Map(packet.cases.map((entry) => [entry.source.rceptNo, entry]));
  const candidates = a.cases
    .filter((entry) => {
      const peer = bByReceipt.get(entry.rceptNo);
      return entry.assessable && peer?.assessable && eventMultisetEqual(
        entry.goldEvents,
        peer.goldEvents,
      );
    })
    .map((entry) => ({
      index: entry.index,
      rceptNo: entry.rceptNo,
      blindCase: blindByReceipt.get(entry.rceptNo),
      agreedGold: entry,
      rank: createHash('sha256').update(`${seed}:${entry.rceptNo}`).digest('hex'),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .slice(0, 5)
    .map(({ rank, ...entry }) => entry);
  if (candidates.length !== 5) throw new Error(`Slice ${slice} has fewer than five agreements.`);
  sample.push(...candidates);
}

const artifact = {
  schemaVersion: 'jaroo.opendart-event-agreement-spotcheck-packet.v1',
  generatedAt: new Date().toISOString(),
  predictionBlind: true,
  seed,
  sampleSize: sample.length,
  cases: sample.sort((left, right) => left.index - right.index),
};
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (serialized.includes('eventExtraction') || serialized.includes('filingClassification')) {
  throw new Error('Spot-check packet accidentally contains predictions.');
}
await writeFile(resolve(packetDir, 'agreement-spotcheck-packet.json'), serialized, 'utf8');
console.log(JSON.stringify({
  output: resolve(packetDir, 'agreement-spotcheck-packet.json'),
  sampleSize: sample.length,
  indices: artifact.cases.map((entry) => entry.index),
}, null, 2));

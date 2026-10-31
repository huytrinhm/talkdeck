import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalMicrophone } from '../client/microphone.js';
import type { AudioInput } from '../client/api.js';

test('voice uploads start with the first frame and commit only at a pause or slide boundary', async () => {
  let slideId = 'n10';
  const sent: AudioInput[] = [];
  const binding = () => ({ epoch: 1, slideId, practice: false, modeStartedAtMs: 0, nextSequence: 0 });
  const mic = new CanonicalMicrophone({ binding, canCapture: () => true, serverNow: () => 0,
    async send(chunk) { sent.push(chunk); }, level() {}, change() {}, pending() {}, error(message) { throw new Error(message); } });
  (mic as any).binding = binding();
  const frame = (sample: number, rms = .1) => (mic as any).receive(new ArrayBuffer(12000), sample, rms);
  try {
    frame(0); await mic.retry();
    assert.equal(sent.length, 1); assert.equal(sent[0].final, false); assert.equal(sent[0].endMs, 250);
    frame(6000); await mic.retry();
    assert.equal(sent[1].utteranceId, sent[0].utteranceId);
    slideId = 'n20'; frame(12000); await mic.retry();
    assert.equal(sent[2].final, true); assert.equal(sent[2].slideId, 'n10');
    assert.equal(sent[2].pcm.byteLength, 0); assert.equal(sent[2].endMs, 500);
    assert.equal(sent[3].slideId, 'n20'); assert.notEqual(sent[3].utteranceId, sent[0].utteranceId);
    frame(18000, 0); frame(24000, 0); await mic.retry();
    assert.equal(sent.at(-1)?.final, true);
    assert.equal(sent.filter(p => p.final).length, 2);
    assert.deepEqual(sent.map(p => p.sequence), sent.map((_, i) => i));
  } finally { mic.dispose(); }
});

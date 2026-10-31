import test from 'node:test';
import assert from 'node:assert/strict';
import { TranscriptPreview } from '../server/transcript-preview.js';
test('provisional chunks accumulate, final wording replaces them, and late deltas cannot corrupt it', () => {
  const preview = new TranscriptPreview('audio-1', 3, 'n10');
  const event = (type: string, fields: object) => preview.event({ type: `conversation.item.input_audio_transcription.${type}`, item_id: 'item', ...fields });
  event('delta', { delta: 'Four' }); event('delta', { delta: 'ty people' });
  assert.equal(preview.snapshot().text, 'Fourty people');
  event('completed', { transcript: 'Forty people.' });
  assert.equal(preview.snapshot().text, 'Forty people.');
  assert.equal(event('delta', { delta: ' stale' }), false);
  assert.deepEqual(preview.snapshot(), { id: 'audio-1', epoch: 3, slideId: 'n10', text: 'Forty people.' });
  assert.equal(new TranscriptPreview('audio-2', 4, 'n20').snapshot().text, '');
});

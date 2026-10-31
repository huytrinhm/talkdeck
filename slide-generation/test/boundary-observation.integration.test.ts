import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLocalRuntime } from '../src/runtime.js';
import { JsxBackend } from '../src/host/jsx-backend.js';
import { SpeechGate } from '../src/orchestration/gate.js';

test('real boundary pixels are shared across narration-only changes but refreshed for visible edits; renders omit embedded bytes', async () => {
  await mkdir('.artifacts/tests', {recursive:true});
  const directory = await mkdtemp('.artifacts/tests/boundary-pixels-');
  const local = await createLocalRuntime({directory:resolve(directory)});
  const backend = new JsxBackend(local, {instructions:'Use supplied canonical tools.'});
  await backend.initialize('');
  const signal = new AbortController().signal;
  let captures = 0;
  const screenshot = local.browser.screenshot.bind(local.browser);
  local.browser.screenshot = (...args) => { captures++; return screenshot(...args); };
  try {
    const first = await backend.generation.observe!('n10', signal);
    assert.ok(first.screenshot.length > 1000);
    assert.equal(first.screenshotMimeType, 'image/jpeg');
    const again = await backend.generation.observe!('n10', signal);
    assert.equal(captures, 1);
    assert.equal(first.id, again.id);
    await backend.deliverUtterance({id:'u1',slideId:'n10',text:'Price is $20.',deliveredAtMs:10});
    const spoken = await backend.generation.observe!('n10', signal);
    assert.notEqual(spoken.id, first.id);
    assert.match(spoken.source, /Price is/);
    assert.deepEqual(spoken.screenshot, first.screenshot);
    assert.equal(captures, 1, 'no browser recapture for evidence-only change');
    const invocation = {agent:'fast',role:'fast' as const,slideId:'n10',inferenceId:'edit',signal,context:undefined as unknown};
    invocation.context = backend.generation.context(invocation);
    const read = local.engine.readSource('n10');
    const closing = read.lines.at(-1)!;
    const edited = await backend.generation.invoke(invocation, 'edit_source', {edits:[{snapshotId:read.snapshotId,nodeId:read.nodeId,op:'insert_before',startLine:closing.number,hashes:[closing.hash],text:'<Text role="title">Price is $20.</Text>\n'}]});
    assert.equal((edited.output as any).accepted, true);
    const changed = await backend.generation.observe!('n10', signal);
    assert.equal(captures, 2);
    assert.notDeepEqual(changed.screenshot, spoken.screenshot);
    const rendered = await backend.generation.invoke(invocation, 'render', {slideId:'n10'});
    assert.ok((rendered.output as any).omittedDataUrls > 0);
    assert.doesNotMatch(JSON.stringify(rendered.output), /data:font/);
    assert.ok(JSON.stringify(rendered.output).length < 30000);
  } finally { await backend.close(); await local.close(); await rm(directory,{recursive:true,force:true}); }
});

test('speech gate rejects a decision whose supplied slide changed without losing pending narration', async () => {
  let release!: (value:'dispatch'|'hold')=>void;
  let entered!: ()=>void;
  const started = new Promise<void>(r => entered=r);
  let revision=1;
  const dispatched:number[]=[];
  const gate = new SpeechGate({evaluate:async input => {
    assert.equal((input.deck as any).revision, 1);
    entered(); return new Promise(r=>release=r);
  }},speech=>dispatched.push(speech.revision),'',undefined,8,30000,'n10',async()=> {
    const captured=revision;
    return {input:{deck:{revision:captured}},isCurrent:()=>revision===captured};
  });
  try {
    gate.receive('A complete claim.',1);
    const pending=gate.tick(); await started;
    revision=2; release('dispatch'); await pending;
    assert.deepEqual(dispatched,[]);
    assert.equal(gate.latest?.revision,1);
    assert.equal(gate.lastDispatched,null);
  } finally {gate.close();}
});

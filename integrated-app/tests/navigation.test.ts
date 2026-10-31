import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationTarget } from '../client/navigation.js';
import type { NavigationDeck, Snapshot } from '../shared/protocol.js';
const snapshot = {selectedId:'a', build:0, mode:'present', revision:'r1', epoch:1, slides:[{id:'a'}, {id:'b'}, {id:'c'}]} as Snapshot;
const deck: NavigationDeck = {revision:'r1',epoch:1,mode:'presentation',slides:['a','b','c'].map(slideId=>({slideId,html:`<div>${slideId}</div>`,css:'',builds:[0,2],readiness:{revision:'r1',ready:true}}))};
test('local navigation follows canonical builds and the latest click instead of delayed snapshots', () => {
  const build = navigationTarget(snapshot,deck,undefined,'next')!;
  assert.equal(build.slideId,'a'); assert.equal(build.build,2);
  const slide = navigationTarget(snapshot,deck,build,'next')!;
  assert.equal(slide.slideId,'b'); assert.equal(slide.build,0);
  const previous = navigationTarget(snapshot,deck,slide,'previous')!;
  assert.equal(previous.slideId,'a'); assert.equal(previous.build,0);
  assert.equal(navigationTarget(snapshot,deck,undefined,'previous'),undefined);
  const talk = {...snapshot,mode:'talk'} as Snapshot;
  const next = navigationTarget(talk,deck,undefined,'next')!;
  assert.equal(next.slideId,'b');
  assert.equal(navigationTarget(talk,deck,next,'next')!.slideId,'c');
});
test('stale prepared content cannot render or infer presentation builds', () => {
  assert.equal(navigationTarget({...snapshot,epoch:2},deck,undefined,'next'),undefined);
  assert.equal(navigationTarget({...snapshot,revision:'r2'},deck,undefined,'next'),undefined);
  const next = navigationTarget({...snapshot,mode:'talk',revision:'r2'},deck,undefined,'next')!;
  assert.equal(next.slideId,'b'); assert.equal(next.preview,undefined);
});

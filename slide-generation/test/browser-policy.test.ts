import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMeasurement, overflow, intersectionArea } from '../src/browser/policy.js';
import type { SlideMeasurement, TextRun } from '../src/browser/types.js';

const text = (changes: Partial<TextRun> = {}): TextRun => ({ id: 't1:text:0', nodeId: 't1', role: 'body', text: 'Words',
  rects: [{ x: 10, y: 10, width: 200, height: 32 }], bounds: [{ id: 'own:t1', rect: { x: 0, y: 0, width: 500, height: 100 } }],
  fontPx: 32, fontWeight: 400, color: [0,0,0], alpha: 1, onSurface: false, backgrounds: [[255,255,255]], ...changes });
const measurement = (texts = [text()]): SlideMeasurement => ({ slideId: 's1', canvas: { x:0,y:0,width:1920,height:1080 },
  nodes: [], texts, shapeIntersections: [], pendingNodeIds: [], displayFloor: 144 });
test('quantitative policy detects every mandatory check with stable subjects', () => {
  const m = measurement([text({ fontPx: 20, color: [230,230,230], statId: 'value', rects: [{x:10,y:10,width:600,height:20},{x:10,y:40,width:50,height:20}] }), text({ id:'t2:text:0',nodeId:'t2',rects:[{x:30,y:10,width:50,height:20}] })]);
  m.nodes = [{id:'t1',rect:{x:1921,y:10,width:10,height:10},bleed:false}];
  m.shapeIntersections = [{shapeId:'d1',textId:'t1:text:0',nodeId:'t1',pixels:7}];
  const found = evaluateMeasurement(m);
  assert.deepEqual(new Set(found.map(f => f.check)), new Set(['overflow','text-size','contrast','stat-wrap','overlap','shape-under']));
  assert.ok(found.every(f => f.subject && f.magnitude > 0));
});
test('policy has exact geometry thresholds and composited alpha contrast', () => {
  assert.equal(overflow({x:-2,y:0,width:10,height:10},{x:0,y:0,width:1920,height:1080}),2);
  assert.equal(intersectionArea({x:0,y:0,width:10,height:10},{x:10,y:0,width:10,height:10}),0);
  assert.deepEqual(evaluateMeasurement(measurement()), []);
  assert.ok(evaluateMeasurement(measurement([text({alpha:.1})])).some(f => f.check === 'contrast'));
  assert.throws(() => evaluateMeasurement(measurement([text({backgrounds:[]})])), /No composited background/);
  assert.throws(() => evaluateMeasurement(measurement([text({role:'unknown'})])), /Missing font-floor/);
});
test('inline text runs with one vertical baseline do not become wrapped Stats', () => {
  const m = measurement([text({statId:'value',rects:[{x:0,y:0,width:50,height:128}]}),text({id:'t1:text:1',statId:'value',rects:[{x:50,y:10,width:50,height:100}]})]);
  assert.equal(evaluateMeasurement(m).some(f => f.check === 'stat-wrap'), false);
});

test('Stat value and label remain distinct text boxes even when they share one authored node', () => {
  const m = measurement([text({ id: 's1:text:0', nodeId: 's1', role: 'stat', fontPx: 128, statId: 's1:value', rects: [{ x: 10, y: 10, width: 200, height: 150 }] }),
    text({ id: 's1:text:1', nodeId: 's1', role: 'caption', fontPx: 24, rects: [{ x: 10, y: 150, width: 100, height: 30 }] })]);
  assert.ok(evaluateMeasurement(m).some(f => f.check === 'overlap' && f.nodeId === 's1' && f.magnitude === 1000));
});

test('overlap identity and comparison subject do not depend on DOM traversal order', () => {
  const a = text(), b = text({ id: 't2:text:0', nodeId: 't2' });
  const first = evaluateMeasurement(measurement([a,b])).filter(f => f.check === 'overlap');
  const reordered = evaluateMeasurement(measurement([b,a])).filter(f => f.check === 'overlap');
  assert.deepEqual(reordered,first);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/bootstrap.js';
import { allocateIds } from '../src/source/candidate.js';
import { HonoSlideRenderer } from '../src/render/renderer.js';
import { BrowserValidationPipeline } from '../src/browser/pipeline.js';
import type { ReviewCapture, ReviewToken } from '../src/browser/review-capture.js';
import { createVisualDiff, textDifferences } from '../src/practice/visual-diff.js';
import { LUCIDE_VERSION } from '../src/render/icons.js';

const token=(text:string,i:number):ReviewToken=>({text,start:i,end:i+text.length,rects:[{x:i*10,y:40,width:10,height:20}],styles:['normal']});
const tokens=(s:string)=>[...s.matchAll(/[\p{L}\p{N}\p{M}]+|\s+|[^\p{L}\p{N}\p{M}\s]/gu)].map(m=>token(m[0],m.index!));
test('text sequence alignment retains repeated words and Unicode offsets deterministically',()=>{
  const a=tokens('go go café 42%'),b=tokens('go café 43%');
  const diff=textDifferences(a,b);
  assert.deepEqual(diff.map(d=>[d.before.map(t=>t.text).join(''),d.after.map(t=>t.text).join('')]),[['go ', ''],['42','43']]);
  assert.deepEqual(textDifferences(a,b),diff);
});
const source=(content:string)=>allocateIds(createDeck().source.replace('<SpeakerNotes id="n12" />',`<SpeakerNotes id="n12" />${content}`)).source;
const diff=(a:ReviewCapture|null,b:ReviewCapture|null,extra={})=>createVisualDiff({slideId:'n10',version:3,before:a,after:b,beforeNotes:'',afterNotes:'',beforeIndex:0,afterIndex:0,...extra});
test('real immutable captures measure inline-stable text parts, Stat labels, Quote attribution and exact image geometry',async()=>{
  const renderer=new HonoSlideRenderer(),browser=new BrowserValidationPipeline(renderer);
  try{
    const before=source('<Text id="t80" role="title">Exact **café** title</Text><Stat id="s81" value="42%" label="Growth"/><Quote id="q82" by="Mara">Words matter.</Quote>');
    const after=before.replace('42%','43%').replace('**café**','*café*').replace('by="Mara"','by="Ana"');
    const [a,b]=await Promise.all([browser.captureReview(await renderer.render(before,'n10')),browser.captureReview(await renderer.render(after,'n10'))]);
    assert(a.jpeg.length>1000); assert.equal(a.imageDigest.length,64);
    assert.equal(a.geometry.parts.find(p=>p.key==='t80:body')?.text,'Exact café title');
    assert.equal(a.geometry.parts.find(p=>p.key==='s81:value')?.text,'42%');
    assert.equal(a.geometry.parts.find(p=>p.key==='s81:label')?.text,'Growth');
    assert.equal(a.geometry.parts.find(p=>p.key==='q82:attribution')?.text,'Mara');
    const result=diff(a,b);
    assert(result.changes.some(c=>c.kind==='text' && c.beforeText==='42' && c.afterText==='43'));
    assert(result.changes.some(c=>c.kind==='style' && c.nodeId==='t80'));
    assert(result.changes.some(c=>c.kind==='text' && c.nodeId==='q82'));
    for(const c of result.changes) for(const r of [...c.before,...c.after]) assert(r.x>=0&&r.y>=0&&r.width>0&&r.height>0);
    assert.deepEqual(result,diff(a,b));
    assert.equal(result.proposalVersion,3);
    // Captured bytes reconstruct identically without current renderer/assets.
    assert.deepEqual(diff(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b))),result);
  }finally{await browser.close();}
});
test('identity-based changes cover move/resize/style/icons/builds/notes/order and slide add/remove',async()=>{
  const renderer=new HonoSlideRenderer(),browser=new BrowserValidationPipeline(renderer);
  try{
    const before=source(`<Text id="t80" role="title">Retained</Text><Row id="n81"><Icon id="n82" name="arrow-right" catalogVersion="${LUCIDE_VERSION}" alt="Next"/><Text id="t83">Body</Text></Row>`);
    const a=await browser.captureReview(await renderer.render(before,'n10'));
    const b=structuredClone(a);
    const n=b.geometry.nodes.find(n=>n.id==='t83')!;
    n.rect.x+=10;n.rect.width+=20;n.parentId='n10';n.style.color='rgb(255, 255, 255)';n.build=2;
    b.geometry.nodes.find(n=>n.id==='n82')!.visual['data-icon']='arrow-left';
    b.geometry.nodes.push({...n,id:'t99'});
    b.geometry.nodes=b.geometry.nodes.filter(n=>n.id!=='t80');
    const r=diff(a,b,{beforeNotes:'Old',afterNotes:'New',beforeIndex:0,afterIndex:2});
    for(const kind of ['move','resize','style','asset','build','notes','order','insert','delete']) assert(r.changes.some(c=>c.kind===kind),kind);
    assert.equal(diff(null,a).changes[0].kind,'slide-added');
    assert.equal(diff(a,null).changes[0].kind,'slide-deleted');
    const metadata=diff(a,a,{beforeNotes:'Old',afterNotes:'New',beforeIndex:1,afterIndex:0});
    assert(metadata.changes.every(c=>c.precision==='metadata'&&c.before.length===0&&c.after.length===0));
  }finally{await browser.close();}
});

test('wrapped Unicode replacement highlights the changed word on its measured line, not the whole paragraph',async()=>{
  const renderer=new HonoSlideRenderer(),browser=new BrowserValidationPipeline(renderer);
  try {
    const prefix='A reliable presentation preserves every important qualifier and original number. '.repeat(3);
    const before=source(`<Text id="t80">${prefix}The café serves twenty people.</Text>`);
    const after=before.replace('twenty people','thirty people');
    const a=await browser.captureReview(await renderer.render(before,'n10'));
    const b=await browser.captureReview(await renderer.render(after,'n10'));
    const result=diff(a,b), changed=result.changes.find(c=>c.beforeText==='twenty')!;
    assert(changed); assert.equal(changed.afterText,'thirty');
    assert.equal(changed.precision,'text');
    const part=a.geometry.parts.find(p=>p.key==='t80:body')!;
    assert(changed.before[0].y>part.tokens[0].rects[0].y);
    assert(changed.before[0].width<a.geometry.nodes.find(n=>n.id==='t80')!.rect.width/4);
  } finally {await browser.close();}
});

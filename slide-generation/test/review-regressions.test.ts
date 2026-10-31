import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SlideEngine } from '../src/engine.js';
import { createDeck } from '../src/bootstrap.js';
import { FileDeckRepository } from '../src/storage/repository.js';
import { EvidenceInbox } from '../src/storage/inbox.js';
import { DurabilityError } from '../src/storage/files.js';
import { Trace } from '../src/telemetry/trace.js';
import { ToolRegistry } from '../src/tools.js';
import { allocateIds } from '../src/source/candidate.js';
import { nodeById, parseSource } from '../src/parser.js';
import { childNodes } from '../src/schema.js';
import { lineHash } from '../src/hashline.js';
import type { DeckDocument } from '../src/contracts.js';

// Synthetic validator isolates storage/race mechanics; real browser acceptance is
// independently exercised by runtime.integration.test.ts and browser.integration.test.ts.
const passing = {async check(){return{complete:true,findings:[],pendingNodeIds:[]}}};
function change(engine:SlideEngine,id:string,text:string){const r=engine.readSource(id);return{edits:[{snapshotId:r.snapshotId,nodeId:r.nodeId,op:'replace' as const,startLine:1,hashes:r.lines.map(l=>l.hash),text}]};}
async function fixture(document=createDeck(),repoClass=FileDeckRepository,inboxClass=EvidenceInbox){
  await mkdir('.artifacts/tests',{recursive:true});const dir=await mkdtemp('.artifacts/tests/review-');
  const repository=new repoClass(join(dir,'deck.json')), stored=await repository.initialize(document), inbox=new inboxClass(join(dir,'inbox'));
  const engine=new SlideEngine(stored.document,passing,undefined,{repository,inbox,normalize:async s=>s});
  return{engine,repository,inbox,cleanup:()=>rm(dir,{recursive:true,force:true})};
}
function twoSlides(){const seed=createDeck();seed.source=allocateIds(seed.source.replace('</Theme>','<Frame page={true}/></Theme>')
  .replace('<Archive id="n13" />','<Slide version={1} freeForm={{reason:"Second"}}><Transcript/><SpeakerNotes/></Slide><Archive id="n13" />')).source;return seed;}

test('successful atomic replacement returns its known candidate without a fallible post-commit read', async()=>{
  class ReadbackFailure extends FileDeckRepository{
    armed=false;count=0;
    override async load(){if(this.armed&&++this.count===2)throw new Error('injected post-rename readback failure');return super.load();}
  }
  const f=await fixture(createDeck(),ReadbackFailure);
  try{
    // Isolate repository CAS: its only necessary read is the precondition read.
    const previous=await f.repository.load();(f.repository as ReadbackFailure).armed=true;
    const doc={...previous.document,source:previous.document.source.replace('<Brief id="n2" />','<Brief id="n2">Committed</Brief>')};
    const result=await f.repository.compareAndSwap(previous.revision,doc);
    assert.deepEqual(result.document,doc);assert.equal(result.revision,lineHash(doc.source));
    assert.deepEqual((await FileDeckRepository.prototype.load.call(f.repository)).document,doc);
  }finally{await f.cleanup();}
});

test('CRLF persistence and engine reads share one canonical revision while raw input CR remains exact', async()=>{
  const seed=createDeck();seed.source=seed.source.replace(/\n/g,'\r\n');const f=await fixture(seed);
  try{
    assert.equal(f.engine.state().revision,(await f.repository.load()).revision);
    assert.equal((await f.engine.edit(change(f.engine,'n2','<Brief id="n2">CRLF edit</Brief>'))).accepted,true);
    const text='Original\r\nuser\rwords';await f.engine.ingest({id:'u1',slideId:'n10',text,deliveredAtMs:1});await f.engine.settledInput();
    assert.equal(f.engine.readSpeakerNotes('n10').notes,text);
    const reloaded=new SlideEngine((await f.repository.load()).document,passing,undefined,{repository:f.repository,inbox:f.inbox,normalize:async s=>s});
    assert.equal(reloaded.readSpeakerNotes('n10').notes,text);
  }finally{await f.cleanup();}
});

test('completed duplicate conflicts refuse before acknowledgement and cannot poison later input',async()=>{
  const f=await fixture();try{
    const original={id:'u1',slideId:'n10',text:'Original words.',deliveredAtMs:1};await f.engine.ingest(original);await f.engine.settledInput();
    const duplicate=await f.engine.ingest(original);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.pending,false);
    await assert.rejects(f.engine.ingest({...original,text:'Conflicting words.'}),/different data/);
    assert.deepEqual(await f.inbox.pending(),[]);
    await f.engine.ingest({id:'u2',slideId:'n10',text:'Later valid words.',deliveredAtMs:2});await f.engine.settledInput();
    assert.match(f.engine.readSpeakerNotes('n10').transcript,/Later valid words/);
    assert.deepEqual(await f.inbox.pending(),[]);
  }finally{await f.cleanup();}
});

test('stale-target evidence remains durable and explicit while unrelated valid input continues',async()=>{
  const f=await fixture();try{
    const stale={id:'stale',slideId:'missing-slide',text:'Preserve these original words.',deliveredAtMs:1};
    const receipt=await f.engine.ingest(stale);assert.equal(receipt.utteranceId,'stale');await f.engine.settledInput();
    const blocked=await f.inbox.blocked();assert.equal(blocked[0].failure.code,'missing_node');assert.deepEqual(blocked[0].event,stale);
    assert.deepEqual(f.engine.state().blockedInputIds,['stale']);
    await f.engine.ingest({id:'valid',slideId:'n10',text:'This later input must proceed.',deliveredAtMs:2});await f.engine.settledInput();
    assert.match(f.engine.readSpeakerNotes('n10').transcript,/later input must proceed/);
    assert.equal((await f.inbox.blocked()).length,1);
    const restarted=new EvidenceInbox(f.inbox.directory);assert.deepEqual((await restarted.blocked())[0].event,stale);
    await restarted.retryBlocked('stale');assert.deepEqual(await restarted.pending(),[stale]);
  }finally{await f.cleanup();}
});

test('retained input is drained under the commit lock before a racing slide deletion can archive stale evidence',async()=>{
  const f=await fixture(twoSlides());try{
    const before=f.engine.readDocument().source,slide=nodeById(parseSource(before),'n10');
    const deletion=change(f.engine,'n1',before.slice(0,slide.start)+before.slice(slide.end));
    // Durable retention already happened, but the host's acknowledgement/drain callback
    // has not run yet. The edit commit itself must observe the queued input.
    await f.inbox.retain({id:'u-race',slideId:'n10',text:'Retained before deleting this slide.',deliveredAtMs:1});
    await assert.rejects(f.engine.edit(deletion),/match exactly once/);
    assert.match(f.engine.readSpeakerNotes('n10').transcript,/Retained before deleting/);
    const fresh=f.engine.readDocument().source,currentSlide=nodeById(parseSource(fresh),'n10');
    assert.equal((await f.engine.edit(change(f.engine,'n1',fresh.slice(0,currentSlide.start)+fresh.slice(currentSlide.end)))).accepted,true);
    assert.equal(f.engine.readSpeakerNotes('n10').archived,true);assert.match(f.engine.readSpeakerNotes('n10').transcript,/Retained before deleting/);
    assert.deepEqual(await f.inbox.pending(),[]);
  }finally{await f.cleanup();}
});

test('frame page positions advance every moved slide version and are returned as affected identities',async()=>{
  const f=await fixture(twoSlides());try{
    const source=f.engine.readDocument().source,root=parseSource(source),slides=childNodes(root).filter(n=>n.tag==='Slide');
    const [a,b]=slides;
    const reordered=source.slice(0,a.start)+source.slice(b.start,b.end)+source.slice(a.end,b.start)+source.slice(a.start,a.end)+source.slice(b.end);
    const result=await f.engine.edit(change(f.engine,'n1',reordered));assert.equal(result.accepted,true);if(!result.accepted)return;
    for(const slide of slides){assert.equal(result.versions[slide.id!],2);assert.ok(result.affectedIds.includes(slide.id!));}
    assert.equal(result.source.revision,result.revision);
  }finally{await f.cleanup();}
});

test('async trace and tool sinks cannot escape as unhandled rejection after a returned operation',async()=>{
  const trace=new Trace(async()=>{throw new Error('async trace sink');});const engine=new SlideEngine(createDeck(),undefined,trace);
  const registry=new ToolRegistry(engine,{},async()=>{throw new Error('async tool sink');});
  await registry.invoke('read_source',{nodeId:'n2'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(trace.failures,1);assert.equal(registry.recordingFailures,1);
});

test('durability uncertainty exposes the known replaced candidate even if recovery read also fails',async()=>{
  class UncertainRepository extends FileDeckRepository{
    failRecovery=false;
    override async compareAndSwap(expected:string,document:DeckDocument):Promise<never>{await super.compareAndSwap(expected,document);this.failRecovery=true;throw new DurabilityError(this.path,{cause:new Error('directory sync failed')});}
    override async load(){if(this.failRecovery)throw new Error('recovery read failed');return super.load();}
  }
  const f=await fixture(createDeck(),UncertainRepository);try{
    await assert.rejects(f.engine.edit(change(f.engine,'n2','<Brief id="n2">Replaced</Brief>')),/Replacement occurred/);
    assert.match(f.engine.readDocument().source,/Replaced/);assert.match((await FileDeckRepository.prototype.load.call(f.repository)).document.source,/Replaced/);
    assert.equal(f.engine.state().mutationsReady,false);
  }finally{await f.cleanup();}
});

test('receipt and deletion serialize even when durable inbox retention pauses before acknowledgement',async()=>{
  let release!:()=>void,entered!:()=>void;
  const held=new Promise<void>(r=>release=r),arrived=new Promise<void>(r=>entered=r);
  class HeldInbox extends EvidenceInbox{override async retain(input:Parameters<EvidenceInbox['retain']>[0]){const receipt=await super.retain(input);entered();await held;return receipt;}}
  const f=await fixture(twoSlides(),FileDeckRepository,HeldInbox);
  try{
    const before=f.engine.readDocument().source,slide=nodeById(parseSource(before),'n10');
    const deletion=change(f.engine,'n1',before.slice(0,slide.start)+before.slice(slide.end));
    const receipt=f.engine.ingest({id:'held',slideId:'n10',text:'Durable before acknowledgement.',deliveredAtMs:1});await arrived;
    const editing=f.engine.edit(deletion), refused=assert.rejects(editing,/match exactly once/);
    await new Promise(r=>setImmediate(r));release();await receipt;await refused;await f.engine.settledInput();
    assert.match(f.engine.readSpeakerNotes('n10').transcript,/Durable before acknowledgement/);
    assert.deepEqual(await f.inbox.blocked(),[]);
  }finally{release();await f.cleanup();}
});

test('input arriving during final CAS is retained after deletion with an explicit stale-target block',async()=>{
  let release!:()=>void,entered!:()=>void;
  const held=new Promise<void>(r=>release=r),writing=new Promise<void>(r=>entered=r);
  class HeldRepository extends FileDeckRepository{
    hold=false;
    override async compareAndSwap(expected:string,document:DeckDocument){if(this.hold){this.hold=false;entered();await held;}return super.compareAndSwap(expected,document);}
  }
  const f=await fixture(twoSlides(),HeldRepository);
  try{
    const source=f.engine.readDocument().source,slide=nodeById(parseSource(source),'n10');
    (f.repository as HeldRepository).hold=true;
    const deletion=f.engine.edit(change(f.engine,'n1',source.slice(0,slide.start)+source.slice(slide.end)));await writing;
    const original={id:'late',slideId:'n10',text:'Never drop this late original.',deliveredAtMs:2};
    let acknowledged=false;const receipt=f.engine.ingest(original).then(r=>{acknowledged=true;return r;});
    await new Promise(r=>setImmediate(r));assert.equal(acknowledged,false);
    release();assert.equal((await deletion).accepted,true);await receipt;await f.engine.settledInput();
    const blocked=await f.inbox.blocked();assert.deepEqual(blocked[0].event,original);assert.equal(blocked[0].failure.code,'missing_node');
    assert.equal(f.engine.readSpeakerNotes('n10').archived,true);
  }finally{release();await f.cleanup();}
});

test('an oversized retained utterance stays inspectable without preventing later small input',async()=>{
  const f=await fixture();try{
    const huge={id:'large',slideId:'n10',text:'x'.repeat(2_000_001),deliveredAtMs:1};
    await f.engine.ingest(huge);await f.engine.settledInput();
    assert.equal((await f.inbox.blocked())[0].failure.code,'source_limit');
    assert.equal((await f.inbox.blocked())[0].event.text,huge.text);
    await f.engine.ingest({id:'small',slideId:'n10',text:'Small later input.',deliveredAtMs:2});await f.engine.settledInput();
    assert.match(f.engine.readSpeakerNotes('n10').transcript,/Small later input/);
  }finally{await f.cleanup();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProductApp } from '../server/app.js';
import { createPracticeRuntime } from '../../slide-generation/src/practice/runtime.js';
import type { Reviewer, ReviewOutput } from '../../slide-generation/src/practice/contracts.js';
import type { Session, Snapshot } from '../shared/protocol.js';

// Explicit fake provider adapters, with real canonical persistence and Chromium validation.
const noReview:Reviewer={async review(){return {summary:'No fixture changes',feedback:[],proposals:[]};}};
async function fixture(reviewer:Reviewer=noReview) {
  process.env.OPENAI_API_KEY ||= 'fixture-only-no-network';
  await mkdir('.artifacts/tests',{recursive:true});
  const directory=resolve(await mkdtemp('.artifacts/tests/races-'));
  const host=createProductApp({directory,runtimeFactory:options=>createPracticeRuntime({...options,reviewer,
    actors:{autoTick:false,model:{async infer(){throw new Error('No paid generation in race tests');}},decider:{async evaluate(){return 'hold';}},slowDecider:{async evaluate(){return 'hold';}}}})});
  const created=await call(host,'/api/projects',{name:'Race fixture',context:'Private source context'});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const base=`/api/projects/${created.body.id}`;
  const attached=await call(host,`${base}/sessions`,{role:'editor'});
  assert.equal(attached.status,201,JSON.stringify(attached.body));
  const session=attached.body as Session;
  const owner=await host.store.open(created.body.id);
  return {host,base,session,owner,async close(){await host.close();await rm(directory,{recursive:true,force:true});}};
}
type Host=ReturnType<typeof createProductApp>;
async function call(host:Host,path:string,body?:unknown,session?:Session,method=body===undefined?'GET':'POST') {
  const response=await host.app.request(path,{method,headers:{'content-type':'application/json',...(session?{'X-Session-Id':session.id,'X-Session-Token':session.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json() as any};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function state(f:Fixture){return (await call(f.host,`${f.base}/state`,undefined,f.session)).body as Snapshot;}
async function command(f:Fixture,fields:Record<string,unknown>){return call(f.host,`${f.base}/commands`,{id:crypto.randomUUID(),epoch:(await state(f)).epoch,...fields},f.session);}
async function seed(f:Fixture,content='<Text role="title">Before</Text>'){
  const read=f.owner.runtime.local.engine.readSource('n10');
  const result=await f.owner.runtime.local.engine.edit({edits:[{nodeId:read.nodeId,snapshotId:read.snapshotId,op:'replace',startLine:1,hashes:read.lines.map(l=>l.hash),text:read.lines.map(l=>l.text).join('\n').replace('</Slide>',`${content}</Slide>`)}]});
  assert(result.accepted,JSON.stringify(result));
}

test('failed Present readiness restores the current Talk actor boundary',async()=>{
  const f=await fixture();
  try {
    await seed(f,'<Text role="title">Before</Text><Pending kind="image"/>');
    assert.equal((await command(f,{type:'mode',mode:'talk'})).status,200);
    const epoch=(await state(f)).epoch;
    const result=await command(f,{type:'mode',mode:'present'});
    assert.equal(result.status,409,JSON.stringify(result.body));
    const after=await state(f);
    assert.equal(after.mode,'talk');assert.equal(after.epoch,epoch);
    assert.equal(f.owner.runtime.actors.practiceMode,false,'failed mode transition must not change narration routing');
    assert.equal(f.owner.runtime.actors.paused,false,'failed transition must not strand the Talk scheduler paused');
  }finally{await f.close();}
});

test('cancelling a prior review job cannot switch another attachment out of Talk',async()=>{
  let entered!:()=>void;
  const reviewing=new Promise<void>(resolve=>{entered=resolve;});
  const f=await fixture({async review(){entered();return new Promise<ReviewOutput>(()=>{});}});
  try {
    await seed(f);
    assert.equal((await command(f,{type:'mode',mode:'practice',input:'transcript'})).status,200);
    const practiceId=(await state(f)).practiceId!;
    assert.equal((await call(f.host,`${f.base}/practice/${practiceId}/finish`,{},f.session)).status,202);
    await reviewing;
    const second=(await call(f.host,`${f.base}/sessions`,{role:'editor'})).body as Session;
    assert.equal((await call(f.host,`${f.base}/commands`,{id:'second-talk',epoch:(await state(f)).epoch,type:'mode',mode:'talk'},second)).status,200);
    const before=await state(f);
    const cancelled=await call(f.host,`${f.base}/practice/${practiceId}/cancel`,{},f.session);
    assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
    const after=await state(f);
    assert.equal(after.mode,'talk');assert.equal(after.epoch,before.epoch);
    assert.equal(f.owner.runtime.actors.paused,false);
    assert.equal(f.owner.runtime.practice.get(practiceId).status,'cancelled');
  }finally{await f.close();}
});

test('duplicate commands are project-scoped across attachments and reconnect, and stale inputs refuse',async()=>{
  const f=await fixture();
  try {
    const second=(await call(f.host,`${f.base}/sessions`,{role:'editor'})).body as Session;
    const before=await state(f),body={id:'one-add',epoch:before.epoch,type:'add'};
    const responses=await Promise.all([call(f.host,`${f.base}/commands`,body,f.session),call(f.host,`${f.base}/commands`,body,second)]);
    assert(responses.every(r=>r.status===200),JSON.stringify(responses));
    assert.equal((await state(f)).slides.length,before.slides.length+1);
    // Talk is now the initial mode; cross a real mode boundary before testing stale epochs.
    const boundary=await command(f,{type:'mode',mode:'practice',input:'transcript'});assert.equal(boundary.status,200);
    await call(f.host,`${f.base}/sessions/${f.session.id}`,undefined,f.session,'DELETE');
    f.session=(await call(f.host,`${f.base}/sessions`,{role:'editor'})).body;
    assert.equal((await call(f.host,`${f.base}/commands`,body,f.session)).status,200,'same durable command can replay its receipt after epoch changes');
    assert.equal((await state(f)).slides.length,before.slides.length+1);
    assert.equal((await call(f.host,`${f.base}/commands`,{...body,type:'next'},f.session)).status,409);
    const late=await call(f.host,`${f.base}/input`,{id:'late-before-mode',epoch:before.epoch,slideId:before.selectedId,text:'Do not insert me',startMs:0,endMs:1000},f.session);
    assert.equal(late.status,409);
    assert.doesNotMatch(f.owner.runtime.local.engine.readDocument().source,/Do not insert me/);
  }finally{await f.close();}
});

test('ambiguous post-commit command failure keeps its durable ID and never repeats Add',async()=>{
  const f=await fixture();
  try {
    const before=await state(f),body={id:'interrupted-add',epoch:before.epoch,type:'add'};
    const create=f.owner.runtime.backend.createSlide.bind(f.owner.runtime.backend);
    let calls=0;
    f.owner.runtime.backend.createSlide=async(...args)=>{calls++;await create(...args);throw new Error('Synthetic post-commit callback failure');};
    const first=await call(f.host,`${f.base}/commands`,body,f.session);assert(first.status>=400);
    const second=await call(f.host,`${f.base}/commands`,body,f.session);assert(second.status>=400);
    assert.equal(calls,1,'retry must reconcile retained pending receipt, not perform another mutation');
    assert.equal((await state(f)).slides.length,before.slides.length+1);
  }finally{await f.close();}
});

const proposalReviewer:Reviewer={async review({context}){
  const read=context.baseline.reads.find(r=>r.nodeId==='n10')!,line=read.lines.find(l=>l.text.includes('Before'))!;
  return {summary:'Fixture review',feedback:[],proposals:[{id:'p1',title:'Fixture title',rationale:'Test private proposal',feedbackIds:[],evidenceIds:['n10'],alternativeTo:[],edits:[{nodeId:read.nodeId,snapshotId:read.snapshotId,op:'replace',startLine:line.number,hashes:[line.hash],text:line.text.replace('Before','After')}]}]};
}};
test('Present freezes canonical context and proposal acceptance; later stale acceptance preserves the live deck',async()=>{
  const f=await fixture(proposalReviewer);
  try {
    await seed(f);
    await command(f,{type:'mode',mode:'practice',input:'transcript'});
    const practiceId=(await state(f)).practiceId!,route=`${f.base}/practice/${practiceId}`;
    await call(f.host,`${route}/finish`,{},f.session);
    const record=await f.owner.runtime.practice.wait(practiceId),p=record.proposals[0];
    assert.equal(p.status,'ready',p.error??'');
    assert.equal((await command(f,{type:'mode',mode:'present'})).status,200);
    const source=f.owner.runtime.local.engine.readDocument().source;
    const context=await command(f,{type:'context',context:'Changed while presenting'});
    assert.equal(context.status,409,JSON.stringify(context.body));
    const accepted=await call(f.host,`${route}/proposals/${p.id}/accept`,{version:p.version},f.session);
    assert.equal(accepted.status,409,JSON.stringify(accepted.body));
    assert.equal(f.owner.runtime.local.engine.readDocument().source,source);
    await command(f,{type:'mode',mode:'review'});
    const read=f.owner.runtime.local.engine.readSource('n10');
    const edit=await f.owner.runtime.local.engine.edit({edits:[{nodeId:read.nodeId,snapshotId:read.snapshotId,op:'replace',startLine:1,hashes:read.lines.map(l=>l.hash),text:read.lines.map(l=>l.text).join('\n').replace('Before','Concurrent')} ]});
    assert(edit.accepted);
    const stale=await call(f.host,`${route}/proposals/${p.id}/accept`,{version:p.version},f.session);
    assert.equal(stale.status,200,JSON.stringify(stale.body));assert.equal(stale.body.status,'stale');
    assert.match(f.owner.runtime.local.engine.readDocument().source,/>Concurrent</);
  }finally{await f.close();}
});

test('SSE reconnect detects missing or impossible cursors and audience replay contains only public viewer data',async()=>{
  const f=await fixture();
  try {
    await seed(f);
    const editor=f.owner.sessions.get(f.session.id)!;
    for(let i=0;i<260;i++)f.owner.broadcastSnapshot();
    const missing:any[]=[];const stopMissing=f.owner.subscribe(editor,0,e=>missing.push(e));stopMissing();
    assert.equal(missing[0]?.type,'resync','cursor before bounded queue must request a bootstrap');
    const future:any[]=[];const stopFuture=f.owner.subscribe(editor,editor.nextEvent+100,e=>future.push(e));stopFuture();
    assert.equal(future[0]?.type,'resync','cursor ahead of this attachment must request a bootstrap');
    await command(f,{type:'mode',mode:'present'});
    const result=await call(f.host,`${f.base}/sessions`,{role:'audience'});
    assert.equal(result.status,201,JSON.stringify(result.body));
    const audience=result.body as Session,attachment=f.owner.sessions.get(audience.id)!;
    const replay:any[]=[];const stop=f.owner.subscribe(attachment,0,e=>replay.push(e));
    await command(f,{type:'blackout',value:true});stop();
    assert(replay.some(e=>e.type==='viewer'));assert(replay.some(e=>e.type==='blackout'));
    assert(!replay.some(e=>e.type==='snapshot'));
    assert.doesNotMatch(JSON.stringify(replay),/Private source context|SpeakerNotes|Transcript|candidateSource|provider|apiKey/);
    await command(f,{type:'mode',mode:'talk'});
    assert.equal((await call(f.host,`${f.base}/viewer`,undefined,audience)).status,401,'ended audience attachment cannot observe later edits');
  }finally{await f.close();}
});

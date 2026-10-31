import { createServer, request as upstreamRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const token=process.env.TALKDECK_GATEWAY_TOKEN;
if(!token||Buffer.byteLength(token)<32)throw new Error('TALKDECK_GATEWAY_TOKEN must contain at least32 bytes');
const expected=Buffer.from(token);
const allowed=['accept','content-type','last-event-id','x-session-id','x-session-token','x-input-id','x-epoch','x-slide-id','x-start-ms','x-end-ms','x-audio-sequence'];
const exposed=['content-type','content-disposition','cache-control','etag','x-deck-revision'];
const server=createServer((incoming,outgoing)=>{
  const supplied=incoming.headers['x-talkdeck-gateway-token'];
  const actual=Buffer.from(typeof supplied==='string'?supplied:'');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){
    outgoing.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});
    outgoing.end(JSON.stringify({code:'gateway_access',message:'Gateway access denied'}));return;
  }
  let path;
  try{const parsed=new URL(incoming.url,'http://gateway');if(parsed.origin!=='http://gateway'||!(parsed.pathname==='/api'||parsed.pathname.startsWith('/api/')))throw new Error();path=parsed.pathname+parsed.search;}
  catch{outgoing.writeHead(404);outgoing.end('Not found');return;}
  if(!['GET','HEAD','POST','DELETE'].includes(incoming.method)){outgoing.writeHead(405);outgoing.end('Method not allowed');return;}
  // Do not forward the gateway secret, cookies, browser Origin, or any forwarded-host identity.
  const headers={'host':'127.0.0.1:3001'};
  for(const name of allowed)if(typeof incoming.headers[name]==='string')headers[name]=incoming.headers[name];
  const upstream=upstreamRequest({hostname:'127.0.0.1',port:3001,path,method:incoming.method,headers},response=>{
    const safe={'cache-control':'no-store'};
    for(const name of exposed)if(response.headers[name]!==undefined)safe[name]=response.headers[name];
    outgoing.writeHead(response.statusCode??502,safe);
    response.pipe(outgoing);
    response.on('error',()=>outgoing.destroy());
  });
  upstream.on('error',()=>{
    if(!outgoing.headersSent){outgoing.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});outgoing.end(JSON.stringify({code:'backend_unavailable',message:'The local canonical backend is unavailable.'}));}
    else outgoing.destroy();
  });
  incoming.on('aborted',()=>upstream.destroy());
  outgoing.on('close',()=>upstream.destroy());
  incoming.pipe(upstream);
});
server.requestTimeout=0; // SSE remains open; capture/review timeouts are owned by the canonical service.
server.headersTimeout=15000;
server.listen(3003,'127.0.0.1',()=>console.log('Protected Talkdeck gateway listening on http://127.0.0.1:3003'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));

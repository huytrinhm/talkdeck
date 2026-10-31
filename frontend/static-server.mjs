import http from 'node:http';
import {realpath,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon'};
/** Serve only a completed frontend build. No database, backend proxy, credentials or source-file serving. */
export async function createStaticServer({root=resolve(fileURLToPath(new URL('.',import.meta.url)),'dist')}={}){
 const directory=await realpath(root);
 if(!(await stat(resolve(directory,'index.html'))).isFile())throw new Error('Build output is missing index.html. Run npm run build first.');
 return http.createServer(async(req,res)=>{
  const send=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:text)};
  if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');send(405,'Method not allowed');return;}
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url??'/', 'http://frontend.invalid').pathname);if(pathname.includes('\0')||pathname.includes('\\'))throw new Error();}catch{send(400,'Invalid path');return;}
  if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:'{"status":"ready"}');return;}
  if(pathname.split('/').some(part=>part.startsWith('.'))||pathname.startsWith('/api/')||pathname==='/api'){send(404,'Not found');return;}
  let file=resolve(directory,'.'+(pathname==='/'?'/index.html':pathname));
  if(file!==directory&&!file.startsWith(directory+sep)){send(404,'Not found');return;}
  try{
   try{file=await realpath(file);if(!file.startsWith(directory+sep)||(await stat(file)).isDirectory()){send(404,'Not found');return;}}
   catch{if(extname(pathname)||pathname.startsWith('/assets/')){send(404,'Not found');return;}file=resolve(directory,'index.html');}
   const info=await stat(file),type=types[extname(file)]??'application/octet-stream';
   const immutable=pathname.startsWith('/assets/')&&/-[\w-]+\.[a-z0-9]+$/i.test(file);
   res.setHeader('Content-Type',type);res.setHeader('Cache-Control',immutable?'public, max-age=31536000, immutable':'no-cache');res.setHeader('X-Content-Type-Options','nosniff');
   const gzip=info.size>1024&&/^(text\/|application\/(json|javascript))/.test(type)&&/\bgzip\b/.test(req.headers['accept-encoding']??'');res.setHeader('Vary','Accept-Encoding');
   if(gzip)res.setHeader('Content-Encoding','gzip');else res.setHeader('Content-Length',info.size);
   if(req.method==='HEAD'){res.end();return;}
   if(gzip)await pipeline(createReadStream(file),createGzip(),res);else await pipeline(createReadStream(file),res);
  }catch(error){if(!res.headersSent)send(500,'Unable to serve this file');else res.destroy(error instanceof Error?error:undefined);}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const host=process.env.HOST??'127.0.0.1',port=Number(process.env.PORT??8873);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535.');
 const server=await createStaticServer();server.listen(port,host,()=>console.log(`Talkdeck frontend: http://${host}:${port}`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>{server.closeAllConnections();process.exit(0)},10000).unref()});
}

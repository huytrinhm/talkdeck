import {beforeAll,afterAll,it,expect} from 'vitest';
import {resolve} from 'node:path';
import type {Server} from 'node:http';
// Built-in Node server tests use an ephemeral HTTP port. No browser is launched or controlled.
// @ts-expect-error Plain ESM operational entry point, tested through its HTTP boundary.
import {createStaticServer} from '../static-server.mjs';
let server:Server,url:string;
beforeAll(async()=>{server=await createStaticServer({root:resolve('tests/static-fixture')});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error();url=`http://127.0.0.1:${address.port}`});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))});
it('serves the built application, separate audience entry and health status',async()=>{const response=await fetch(url);expect(await response.text()).toContain('Talkdeck fixture');expect(response.headers.get('cache-control')).toBe('no-cache');expect(await (await fetch(url+'/audience.html')).text()).toContain('Audience fixture');expect(await (await fetch(url+'/healthz')).json()).toEqual({status:'ready'})});
it('sets immutable cache only for hashed assets and supports HEAD',async()=>{const response=await fetch(url+'/assets/main-test123.js',{method:'HEAD'});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('immutable');expect(response.headers.get('content-type')).toContain('javascript');expect(await response.text()).toBe('')});
it('does not replace missing assets, APIs or source files with misleading success HTML',async()=>{for(const path of ['/assets/missing.js','/src/App.tsx','/.env','/api/generate'])expect((await fetch(url+path)).status).toBe(404);expect((await fetch(url+'/',{method:'POST'})).status).toBe(405)});

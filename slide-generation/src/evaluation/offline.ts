import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { SourceError } from '../contracts.js';
/** Application-level guard; Chromium separately aborts all external page requests in the real check pipeline. */
export function disableReplayNetwork() {
  const original = { fetch: globalThis.fetch, request: http.request, get: http.get, secureRequest: https.request, secureGet: https.get, connect: net.Socket.prototype.connect };
  let blockedAttempts = 0;
  const blocked = () => { blockedAttempts++; throw new SourceError('offline_network', 'Network access is forbidden during recorded replay; no live fallback'); };
  globalThis.fetch = blocked as typeof fetch;
  http.request = blocked as typeof http.request; http.get = blocked as typeof http.get;
  https.request = blocked as typeof https.request; https.get = blocked as typeof https.get;
  net.Socket.prototype.connect = blocked as typeof net.Socket.prototype.connect;
  syncBuiltinESMExports();
  return {
    evidence: () => ({ nodeNetworkDisabled: true, browserRequestsAbortedByCheckPipeline: true, blockedAttempts, osNetworkNamespace: false }),
    restore() {
      globalThis.fetch = original.fetch; http.request = original.request; http.get = original.get;
      https.request = original.secureRequest; https.get = original.secureGet; net.Socket.prototype.connect = original.connect;
      syncBuiltinESMExports();
    },
  };
}

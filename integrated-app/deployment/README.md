# ChatGPT Site with the local canonical backend

The ChatGPT Site serves the built integrated frontend and proxies API
requests through an HTTPS tunnel to this gateway. Generation, persistent project
storage, ASR, practice, validation and rendering continue in the existing local
Node/Chromium backend on port 3001. This deployment is available only while that
backend, the gateway and the tunnel are running. It does not move credentials,
project recordings or the generation engine into a Worker.

The Site was made public at the user’s explicit request. It exposes one shared
workspace without ChatGPT sign-in; it is not a multi-user isolation release. The adapter
rejects cross-origin browser API requests and forwards only explicit application
transport headers. The local gateway listens on loopback port 3003 and compares
its random secret using Node's constant-time comparison before forwarding to
loopback port 3001. The gateway credential, browser Origin, cookies and forwarded
identity/host headers never reach the product backend. Streaming SSE and audio
request bodies pass through without buffering entire sessions.

Required environment:

- Local canonical backend: existing shell-sourced model credentials.
- Local gateway: `TALKDECK_GATEWAY_TOKEN`, generated randomly with at least32 bytes.
- Site runtime: `TALKDECK_GATEWAY_TOKEN` with the same value, and
  `TALKDECK_BACKEND_URL` with the HTTPS tunnel origin (no path/query/credentials).

Configure Site values through native Sites secrets tools. Never put values into
source, the hosting manifest, command-line arguments or a frontend bundle. No
OpenAI key is configured in the Site.

Start the protected gateway after exporting its token in the shell:

```sh
node integrated-app/deployment/gateway.mjs
```

Point the HTTPS tunnel at `http://127.0.0.1:3003`, never directly at port3001.
Changing an ephemeral tunnel URL requires updating the Site runtime value.

Build the integrated frontend as normal, then from `integrated-app/site/`:

```sh
node scripts/embed-frontend.mjs
bash scripts/build.sh
node scripts/validate-artifact.mjs
```

The generator reads only regular allowlisted frontend build assets under the
sibling `dist/`, checks for known secret values present in its environment, and
embeds an immutable dictionary into `worker/index.js`. Worker ESM packaging copies
that single generated module and the Sites manifest. `worker/handler.js` is the
editable proxy/static handler; rebuild after frontend or handler changes.
The Site source repository contains only this adapter and sanitized frontend
assets; do not package the integrated application's `.data`, `.artifacts`, backend
source, local `.env`, or tunnel state. Runtime secrets belong exclusively in native
Sites secret configuration.

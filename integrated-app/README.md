# Talkdeck integrated app

The root-level product composition reuses the canonical slide-generation runtime,
real actors, PracticeService, packaged viewer and existing frontend UI components.
It never uses legacy Slide objects or local heuristic generation for canonical projects.

## Run locally

Install dependencies in `../slide-generation`, `../frontend` and this directory
with `npm ci`. Start two terminals from this directory:

```sh
set -a
source ../slide-generation/.env
set +a
npm run server
```

```sh
npm run dev
```

Open http://localhost:3000. The API listens on loopback port 3001. Application code
reads process environment only. Projects and provider evidence live in ignored
`.data/projects/`; one runtime owns each project. Projects always open in Talk with microphone input. The centered voice panel sits above the filmstrip; typed transcript input is not available in the workspace.
Modes are not saved. The editor sidebar is on the right. Legacy workspace,
exports, Undo/Redo and saved-session history controls have been removed.

`npm run check` covers browser and server TypeScript; `npm test` exercises product
contracts and races using real Chromium with explicitly fake provider adapters.
`npm run build` creates the browser bundle. Runtime browser validation remains
mandatory for canonical edits and prepared proposals.

Project image uploads (PNG, JPEG, WebP and self-contained SVG) are registered with
immutable content-hash versions and supplied to the canonical renderer through
its asset resolver. The project brief includes their exact `Image` references for
generation actors. Context shows image previews and availability for slides.
Existing image uploads are registered when a project opens; unsafe SVGs or invalid
image signatures stay unavailable for slides. Other files retain their existing
text-context or reference-only behavior. Assets remain project-scoped across restarts.
Fast, Slow and specialist agents can call `search_assets` to search image filenames,
media types and IDs, or browse with an empty query. Results are paginated and include
exact canonical image references. Search calls are recorded as `asset_search` events
in the project's provider log. Decision gates receive catalog availability so image
requests can be dispatched to an agent with access to this tool.

## Hosting

The public ChatGPT Site is https://talkdeck-integrated.thintulip.chatgpt.site.
It uses one shared workspace without ChatGPT sign-in, as requested. The Site
proxies the existing Node/Chromium backend through a protected HTTPS tunnel;
it is available only while this machine, API, gateway and tunnel are running.
See [deployment details](deployment/README.md) and [target identity](deployment/site-target.json).
The independent Sites source checkout is `site/`, excluded from this repository
and versioned in the Sites source repository. No model key is uploaded to Sites.

## Verification checkpoint

See [the implementation evidence](docs/IMPLEMENTATION-EVIDENCE.md). The user
explicitly skipped the remaining verification after deployment. Do not interpret
the deployed application as having passed every M0–M5 release gate.

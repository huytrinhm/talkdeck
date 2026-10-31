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

Project cards expose a delete button on hover or keyboard focus (always visible on touch).
Deletion closes the project runtime and moves its data into ignored `.data/projects/.deleted/`;
the project disappears from the homepage and can no longer be opened through the API.

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

## Responsive speech and controls

Talk/Present upload 250 ms PCM transport frames with a stable `X-Utterance-Id`;
`X-Audio-Final` commits only at a 800 ms pause, slide/capture boundary, or a 12 s
utterance limit. Those limits no longer delay upload or recognition. Practice
retains its 1 s recording chunks and end-pass review. Legacy whole-utterance
uploads without the new headers remain supported. A final packet can be empty.

Audio receipts acknowledge durable PCM, not completed transcription. An ordered,
bounded ASR queue runs outside project-command serialization. Each chunk ID is
idempotent; final ASR creates one transcript by utterance ID. Pending text is grey,
final text white. In Talk, coalesced partial ASR is retained as correction-linked
evidence and sent through the normal decision gate, allowing drafting before a
pause. The final transcript supersedes the last provisional evidence. Present
partials do not generate slides; practice remains end-pass. Late results keep
the original slide/mode/epoch and never edit a replacement slide or a new mode.

Live transcription is configured for English and Vietnamese (`en`, `vi`). Do not
force the single-language `en` parameter on alternative transcription models.
Provider errors remain visible and raw PCM remains on disk; no automatic paid
retry is introduced. Interrupted uncommitted speech requires recovery from saved
evidence/PCM, not guessed completion.

Canonical validation reuses exact rendered browser evidence; thumbnail pixels
are keyed by rendered output/dependencies instead of whole-deck revision. This
avoids recapturing every thumbnail when only one slide or private narration changes.

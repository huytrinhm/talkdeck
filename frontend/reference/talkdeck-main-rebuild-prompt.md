# Talkdeck — standalone reconstruction prompt

Build the web application specified below from an empty workspace. This document is the complete product brief, interaction contract, visual reference, and implementation plan. Do not assume access to a prior conversation, an existing implementation, or a deployed reference site. Deliver functioning code, not screenshots or a landing page. This is the dark main UI, not the warm Folio alternative.

Read this entire file in bounded chunks before implementation. Record all consulted sources in `ACCESS-LOG.md`; this prompt and public dependency documentation are the only product/build references permitted. Do not inspect an original repository, deployed reference, sibling workspace, or previous conversation. This is instruction-enforced clean-room work, not an operating-system access restriction.

## Priority and fidelity

The final refinements and visual contract in this prompt take precedence over any older wording in the detailed inventory. Match the actual bounded browser application described here; do not invent cloud accounts, an LLM backend, fake recognition, generated coaching claims, demo launchers, or marketing pages. Fresh workspace contains no seeded projects. A deterministic QA fixture may be imported by a development-only test harness, never shown as a demo feature in the product.

Main objective: keep attention on the slide. View slides has no audio footer. Talk is a distinct recording mode with one compact voice capsule. Transcript is optional except that Talk initially opens it. Hide drawing complexity behind a small Draw launcher. Use familiar direct slide manipulation and contextual menus. Preserve all user-created data through navigation and reload.

## Implementation stack and deliverables

Use React + TypeScript + Vite, real shadcn/ui components backed by Radix primitives, Lucide icons, and CSS variables/custom CSS for the exact design below. Install packages and author shadcn components in the project (do not merely name a class shadcn). Use native browser SpeechRecognition/webkitSpeechRecognition and Web Audio. IndexedDB stores the workspace and source blobs. Use PptxGenJS for PowerPoint, jsPDF plus canvas rasterization for PDF. No hosted backend is needed for the specified local template/heuristic behavior. No paid API keys.

Suggested architecture: typed workspace model; IndexedDB repository; hash route controller; slide renderer shared by editor/review/audience/export; command dispatcher with undo; speech-session state machine; intent router; drawing canvas; practice snapshot/review engine; accessible UI components. Separate source code from built runtime. Include package scripts dev/build/typecheck/test, README with browser support, and a validation report distinguishing actual tests from untested hardware.

Implement all routes and interactions below. Missing projects must recover to dashboard, never blank/error. Do not start listening until the user explicitly enters a talking mode. In Talk/Practice/Present entry, start automatically and handle browser permissions. No microphone settings sidebar tab.

## Exact visual contract

Desktop reference 1512×900 CSS px; also verify 1280×900, 919×853, 786×853, and 390×844. Match the desktop design first. No horizontal page overflow. Preserve 16:9 slides with contained scaling, not stretched typography. UI and slide typography are separate.

### Design tokens

- Application background #20242b; header/sidebar #191d23; text #edf1f7; secondary text #aab5c5; dividers #353c47; selected accent #a6c9f5; selected fill #2d3f59. Dark color scheme.
- App font Inter when bundled, then -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; base 14px. Native slide font stack is given in the slide CSS appendix.
- Standard buttons min-height 34px, padding 6px 11px, gap 7px, radius 5px, font 12px/600; transparent or surface fill, 1px divider border. Hover #2c333e and white foreground. Primary #dce8fc with #243b60 text; hover #c2d8f7 with #1d3153 text. No gradients or decorative shadows.
- Icon buttons 34px square, 6px padding; icons 18px, stroke 1.75. Tooltips provide action and shortcut. Focus-visible 2px #a6c9f5 outline with 3px offset, never clipped.
- Key hints 10px monospace, #303a49 background, #c7d6ee foreground, radius 3px, padding 2px 4px. Disabled controls remain readable and cannot activate.
- Inputs #20262f, text #edf1f7, border #424c5b, radius 5px, padding 10px. Hover/focus never introduce a white field with light text.
- Context menus #222831, border #465060, shadow 0 12px 32px #0005, max-height 70vh; 12px menu rows, hover #344158. Use actual accessible menus, dismissal outside/Escape, keyboard navigation and focus return.

### Dashboard and setup layout

Dashboard has a fixed left sidebar approximately 208px wide, full height, hairline right divider; right column has search header 64px and scrolling content with 32px padding. Wordmark Talkdeck uses the Lucide Speech icon, no invented logo geometry. Folder rows are compact, indented 18px per level with guide lines, chevrons and right-aligned subfolder controls on hover/focus. Folder cards form a responsive grid; project cards use a 16:9 slide preview above title/metadata. The whole card gets a subtle #29323e hover surface and accent border/focus; text as well as preview opens it, while its menu stops propagation. Two project columns at 786px with available content width; increase columns at wider screens, one on phones. Empty preview is dark #29323e with #c3ccda plus and label, not a white box.

New project is a full page, not a giant modal. 48px top bar: Projects back left, Create project primary right. Content max-width about 1120px with 32px gutters, heading New project, two columns (roughly 55% details / 45% sources), 32px gap and a vertical separator. Stack on phones. Fields: Title, optional Description, Agent instructions disclosure containing System prompt, Folder browser. No lecture-context field. Materials column has a compact rounded Add sources button; clicking opens Files/Copied text dialog. Copied text is an editor with title and large monospaced body, not a giant raw input. Title field 48px high with balanced 10px vertical padding and an inset focus ring so the caret/text stays inside the border. File preview code surface #171e28, text #e6edf6, border #46546a, monospace 13px/1.75.

### Slide workspace

- Header 48px high, padding 0 14px, gap16. Left back arrow and title13px/600, max-width420px with ellipsis. Right: Talk to generate (primary), Practice, Present, then a subtle divider and utility icons Theme, Audience, Settings, Export, Sidebar. Sidebar is always rightmost and its icon's right pane visibly fills when open. Practice/Present are secondary. At narrow widths reduce gaps/padding and truncate title before hiding essential actions.
- View slides rows: 48px header / flexible stage / 92px filmstrip; no bottom voice dock. Talk rows: 48px / flexible stage / 80px filmstrip / 66px voice dock. Presenter: 48px / flexible body / 66px controls, up to108px controls below1000px; no filmstrip. On very small screens permit stacked controls without overlap.
- Stage centers the largest fitting 16:9 slide; preserve a 58px left tool allowance (48px below850px) and modest 14px outer inset. Background stays dark. Sidebar width300px, 270 below1100, 240 below850; stack below600 rather than collapsing the slide to unusable width.
- Filmstrip full width, horizontal scrolling, gap10px, padding5px16px, slide thumbnails116×65.25px. Slide number is a small badge INSIDE bottom-left of thumbnail, no external titles or ticks. Selected thumbnail has prominent pale blue border; inactive thumbnails subtly dim. Add slide tile appears only on empty deck or when last slide is focused.
- Empty canvas #252b35 with #e8edf5 text, radius3px. Center a max420px group with28px padding: heading “Start with an idea” clamp(20px,2.2vw,30px), 1.2 line-height, weight600, tracking-.65px; body “Speak naturally. Your slides take shape as you talk.” at14px/1.6 #b5c0d0, 24px below; pill CTA “Talk to generate”,42px high,10px22px padding,#dce8ff/#243850. It must remain dark even when generated slide theme is Paper.
- Sidebar only Transcript / Context tabs. No close X; use header toggle. Transcript uses spaced time-labelled paragraphs and a streaming caret. Context exposes System prompt and Materials; Description belongs in dedicated Settings. No sketch context cards, explanatory privacy footers or internal implementation messages.
- Draw launcher small at left-middle; opens a dark compact draggable vertical palette with grip, Pen/Highlighter/Eraser and close. Main tool click toggles; corner chevron alone opens colors/width. Keep it off the audio dock.

### Voice interaction treatment

Single capsule height48px, padding4px8px,gap8px,border#46515e,radius999px,background#232a33,no shadow. Pause/Resume icon40px; waveform112×32px with3px bars/gaps (64px wide on narrow screens), idle#7e8b9c, active#b4cff0. Vertical divider before target; target padding-left20px/right12px with12px gap and outlined Space hint. Target labels “To the audience” / “To the agent”. Mute icon last. Agent state background#27374c,border#98b8e4; muted#4a3032/#ffb5ad. Keyboard hints are small; no duplicate row of large buttons. Wave amplitude follows microphone RMS; idle is still, not fake speaking. During agent input subtly tint surrounding stage and animate a narrow perimeter around slide; honor reduced-motion. No new edit-mode explanatory paragraph.

### Presenter/audience

Presenter background near-black #191919, large current slide left, next preview and editable notes in right column (~28%). Compact timer above. Transcript disclosure below notes. Controls are sparse; no lock and no push-to-edit in Present. Audience fills the complete viewport with only contained slide against black. No persistent footer, title, page count or fullscreen button. Return/fullscreen affordances may appear on hover/focus only. Fullscreen removes all application chrome.

### Practice review

Review main max1200px with32–40px gutters. Header title/back and Practice again/Present. Beneath header a horizontal Overview / Slide changes tab row; Done primary at far RIGHT of this row, never header or page bottom. Overview max850px; heading28px; statistics3columns with border-block,padding24,dt12,dd27. Speed chart136px with32px axis and sparse ticks; bars#9dbce7,hover#d5e5ff. Pace/Clarity/Tone feedback each has a 3px left border and16px18px padding: positive#243b32/#81c4a0/text#bce7ce; attention#3b3325/#dbb66d/text#f0d79f; neutral#283445/#8eacd4/text#ceddf2. Color supplements a textual level.

Slide changes: navigation row previous at left,current slide index/title centered,next at right with circular pending-count badges. Two equal columns with Before/After labels, 24px gap; red3px#d68b91 and green3px#80bc9c borders. Changed content is marked INSIDE rendered slides: removed#f7d8dc/#64232c,added#cdeedb/#16472e. No raw text-diff disclosure, no “As rehearsed”/“Accepted change” captions. Suggestion heading/reason below. Approve/Reject buttons equal112×38px on one horizontal line; approve#c4ebd6/#183c2b,reject#f5d1d4/#632c35. Decision badges padded8px14px,radius6,font13/650: accepted#244c3b/#d1f5e0,border#70b995;rejected#533039/#ffdde1,border#d68b96. After acceptance mark After Applied and dim Before Original; after rejection mark Before Kept and dim After Not applied (opacity.64,saturation.35). Exact transcript intervals/comments below, no duplicated technical cards.

Completion max620px,center min-height70vh,padding32,gap18,64px success circle. Approved/rejected counts in two colored columns,width380px,gap14,padding18px24px,numbers34px. Actions44px: Practice again and Done; no Back to review.

## Data model and invariants

Workspace {version:2, folders:Folder[], projects:Project[]}. Folder {id,name,parentId:null|string}. Project {id,title,description,systemPrompt,folderId:null|string,materials:Material[],slides:Slide[],transcript:TranscriptSegment[],createdAt,updatedAt,status:'draft'|'ready',theme}. Slide {id,title,body:string[],notes,layout:'title'|'bullets'|'process'|'comparison'|'quote'|'table'|'code',theme:'paper'|'midnight'|'lavender',tableData?,materialRef?}. Table data contains name,columns,rows,aliases; materialRef retains stable source/table identity and pagination. Materials hold id,name,type,size,blobKey,parsed tables/text,parse status. Preserve legacy metadata if importing but do not expose obsolete features. UUID identities must survive reordering. Do not use array index as identity.

Default system prompt exactly: “Turn my spoken ideas into clear, concise presentation slides. Keep one idea per slide. Use diagrams for processes and comparisons. Preserve my meaning and never invent facts.” Stored prompt is editable context, not proof of an LLM integration.

Recognition session tracks projectId,route,sessionId,status,muted,target,interim,last-final sequence. Accept final events at most once. Abort invalidated sessions. Rehearsal snapshots store slides/order/theme and elapsed active timestamps, per-slide speech intervals, suggestions with baseline dependencies and pending/accepted/rejected state. Keep last3 sessions. Undo30 entries in memory; workspace autosave300ms debounced and immediately on critical mutations. Persist source bytes in IndexedDB, not localStorage base64. Surface save/quota failures without discarding working state.

## Detailed behavior inventory

## 2. Information architecture and modes

| Route / screen | Purpose | Main controls | Entry behavior |
| --- | --- | --- | --- |
| `#folder/all` | All projects and root folders | Search, New project, folder tree | Load saved workspace; a fresh workspace starts empty. |
| `#folder/<folderId>` | Projects directly in a folder and its child folders | Breadcrumb, search, folder actions, New project | Select folder; reveal its ancestors in the tree. |
| `#new/<folderId>` | Create a project | Title, description, instructions, materials, folder, Create project | Offer the next unused “Untitled N” title. |
| `#project/<id>/edit` | View and organize slides | Talk to generate, Practice, Present, Audience, Settings, Theme, Export, Sidebar | Show slide canvas and horizontal filmstrip; no speech-control footer. |
| `#project/<id>/create` | Talk to generate and edit | Pause/Resume, audience/agent toggle, Mute, Finish | Request microphone recognition automatically and open Transcript. |
| `#project/<id>/present` | Present to an audience | End, Fullscreen, Audience, Pause/Resume, Mute, Black screen, navigation | Request microphone recognition automatically when slides exist. |
| `#project/<id>/practice` | Rehearse without modifying the rehearsal snapshot | Finish practice, Fullscreen, Audience, input, navigation | Create a rehearsal snapshot and begin input. |
| `#project/<id>/review` | Evaluate delivery and decide slide changes | Overview, Slide changes, Approve/Reject, Done | Open Overview; entering Slide changes resets to the first slide. |
| `#project/<id>/context` | Legacy dedicated context editor | Project/context fields and materials | Still exists as a secondary route; differs from the streamlined sidebar. |
| `audience.html?project=<id>` | Separate clean audience window | Fullscreen | Read same-origin slide output; do not expose private editor panels. |

Unknown project views fall back to slide editing. Missing projects return to the dashboard. A route change stops active input and timers, flushes outstanding live edits, and clears transient UI state. Returning to an ordinary project view normally selects the first slide; some explicit return paths preserve the previous selection. Review stores a review index internally, but clicking the Slide changes tab deliberately resets it to zero.

### 2.1 Main end-to-end paths

1. **New presentation:** Create project → enter title/context/materials → Create project → blank slide guide → Talk to generate → speech streams → Finish → view slides.
2. **Refine a deck:** Open project → Talk to generate → switch or hold Space to talk to agent → say a change → inspect the live slide → Finish.
3. **Rehearse:** Open slides → Practice → speak while navigating automatically or manually → Finish practice → Overview → Slide changes → Approve/Reject each suggestion → Done → completion → Done or Practice again.
4. **Present:** Open slides → Present → automatic input → advance manually or through recognized speech context → Audience/Fullscreen if needed → End.
5. **Use prepared data:** Add source files → mention a recognized table by name → render stored table contents without dictating individual cells.

## 3. Dashboard, search, and project cards


| ID | Trigger / element | Required current behavior |
| --- | --- | --- |
| DASH-01 | Talkdeck logo | Navigate to All projects. Current identity uses the Talkdeck wordmark and a library speech icon. |
| DASH-02 | All projects | Show all workspace projects, with a total count. No separate archive workspace is exposed. |
| DASH-03 | Project ordering | Sort by most recently updated first. |
| DASH-04 | Search | Match title and description, case-insensitively, within the current folder filter. It does not search source-file contents or slide text. |
| DASH-05 | `/` | Focus project search when outside editable controls. |
| DASH-06 | Ctrl/Cmd + K | Focus and select the dashboard search field. |
| DASH-07 | No matching projects | Show a specific empty-search message and a suggestion to change the title/description query. |
| DASH-08 | Empty folder | Show “No projects yet” and a create-project action. |
| DASH-09 | Project thumbnail | Show the first slide, or an empty-presentation preview when no slides exist. Clicking opens the project. |
| DASH-10 | Project title and metadata | Act as a project-opening link, not inert caption text. |
| DASH-11 | Card hover/focus | Highlight the interactive card surface; keyboard focus remains visible. Menu actions remain separate from opening the card. |
| DASH-12 | Project metadata | Show Ready or Draft; slide count; last-edited time. |
| DASH-13 | Project options | Anchored menu: Open project, Move to folder, Duplicate project. Project context is absent from this menu. |
| DASH-14 | Duplicate project | Copy deck/settings/material references into a new project with a copy title; copy stored source blobs; clear the new project's practice state. |
| DASH-15 | Demo entry points | Teacher-demo launch, sample speech, pointer demonstrations, and sample-source actions are absent from the normal UI. Existing saved decks are retained. |
| DASH-16 | Open an existing empty project | Open View slides and show the onboarding guide if empty. Speech starts only after entering a speech mode. |

No project deletion or archive command is exposed in the current project menu. This is a current product gap, not an undocumented shortcut.

## 4. Folders and folder browsing

| ID | Trigger / element | Behavior |
| --- | --- | --- |
| FOLD-01 | Folder tree | Show indentation, connector guides, folder/open-folder icons, and expand/collapse controls for parents. |
| FOLD-02 | Expand/collapse | Hide or reveal descendants; remember collapsed folder IDs in local storage. |
| FOLD-03 | Click folder name | Navigate to that folder. Its grid lists direct projects and direct child folders rather than aggregating all descendants. |
| FOLD-04 | Add-subfolder icon on a row | Open folder creation with that folder as the parent. |
| FOLD-05 | Create folder | Require a non-empty name, maximum 80 characters; reject a same-name sibling without regard to case. |
| FOLD-06 | Folder card options | Open folder, New project, New subfolder, Rename folder. The ellipsis does not immediately rename. |
| FOLD-07 | Rename | Change the folder label without moving its projects or descendants. |
| FOLD-08 | Breadcrumb | Navigate to an ancestor or All projects. |
| FOLD-09 | Tree Up/Down/Home/End | Move focus among visible folder rows. |
| FOLD-10 | Tree Right | Expand a closed parent, or move toward its child when expanded. |
| FOLD-11 | Tree Left | Collapse an expanded parent, or focus its parent. |
| FOLD-12 | Browse project folders | Open a dialog with folder search, breadcrumb navigation, child folders, Cancel, and Use this folder / Use no folder. |
| FOLD-13 | Folder search | Find destinations using folder names/path context; choosing a destination does not submit the project form. |
| FOLD-14 | Move project | Reassign the project's folder through its destination picker. |

Folder deletion, folder drag-and-drop reparenting, permissions, and shared drives are not implemented in the visible dashboard.

## 5. New-project setup and onboarding

| ID | Field / action | Behavior |
| --- | --- | --- |
| SET-01 | Title | Default to the first unused “Untitled N”, compared case-insensitively; required; maximum 120 characters. |
| SET-02 | Description | Optional topic/audience/goals field; maximum 1,600 characters. |
| SET-03 | System prompt | Editable under Agent instructions in setup; maximum 6,000 characters. Stored with the project, but not sent to an LLM in this build. |
| SET-04 | Lecture context | Not shown as a normal new-project field. Older saved context may remain in data and legacy UI. |
| SET-05 | Materials | Compact Add sources entry, source list, removal actions, no sample-source shortcut. |
| SET-06 | Folder | Choose a destination through the hierarchical browser; default reflects the entry location or no folder. |
| SET-07 | Create project | Wait for material analysis to finish, validate title, disable fields while saving, save source blobs and project, then open slide view. |
| SET-08 | Save failure | Report failure and roll back newly stored blobs/project changes where the save transaction fails. Do not claim success. |
| SET-09 | Projects / cancel | Return to dashboard; unsaved setup data does not become a project. |
| SET-10 | Blank slide screen | Show “Start with an idea”, concise guidance, and a light Talk to generate button on a dark slate empty-slide surface. Center the onboarding content in the slide area. Do not display ordinary audio controls here. |
| SET-11 | Empty-deck actions | Practice, Present, Audience, and Export are disabled until slides exist. Talk to generate remains available. |
| SET-12 | Talk to generate | Enter Talk to generate; automatically start the selected speech mode and show Transcript. |


## 6. Sources, file handling, and prepared data

### 6.1 Adding and managing sources

| ID | Action / state | Behavior |
| --- | --- | --- |
| SRC-01 | Add sources | Open a source dialog with Files and Copied text choices. The large upload/editor area stays hidden until requested. |
| SRC-02 | Files | Browse for multiple files or drop files into the drop zone. Accept any extension; no explicit row, column, or 25 MB product cap is imposed. |
| SRC-03 | Copied text | Provide an editor-like text area, optional title, live word count, and Add source. The source title uses a full-width 48px input with balanced vertical padding and an inset focus ring. Saving creates a text-file source. |
| SRC-04 | File list | Show filename, size/status, a type-specific icon, and remove action. Long names must remain usable within the panel. |
| SRC-05 | Type icons | Distinguish spreadsheet/table, image, audio, video, code, archive, presentation, text, and generic files. |
| SRC-06 | Preview | Open a material preview. Render recognized text/tables/images; offer original download when no rich preview exists. |
| SRC-07 | Download | Return the stored original file, not a reconstructed excerpt. |
| SRC-08 | Remove | Remove the material from project context; existing slide content remains. Project-material removal supports the app's undo path. |
| SRC-09 | Existing lesson files | Previously saved Customers/Orders materials remain intact; a new project receives no automatic sample files. |
| SRC-10 | Storage | Keep file blobs in IndexedDB in this browser origin. Adding a file does not upload it to a generative AI service. |

Accepting any file is different from understanding every format. Browser memory and storage quota still apply; “no product cap” is not a guarantee of arbitrarily large-file support.


### 6.2 Parsing and reference behavior

| Source | Interpretation |
| --- | --- |
| CSV | First row is the header; quoted commas, embedded newlines, and doubled quotes are parsed. |
| JSON record array | A flat, consistent array of records can become a table. |
| JSON table object | A columns/rows shape can become a table. |
| JSON tables collection | A tables list can supply multiple named tables, with optional context. |
| JSON context object | A context string can be treated as textual material. |
| Plain text / Markdown | Store text as contextual source material. |
| Other files or unsupported structured data | Preserve as a reference file rather than rejecting the upload solely because table parsing fails. |

Parsed table headers must be non-empty and unique. Rows/cells must fit the supported flat structure; nested or ragged data can fall back to a reference file. Finite numbers, strings, booleans, and null values are supported; unsafe numeric data is not silently treated as exact table content.

Recognized table names and aliases are normalized for punctuation/case and some singular variants. A command such as “Show the Customers table” can render stored table rows without requiring the presenter to read every cell. Ambiguous names require a more specific reference. Large tables use the renderer's layout splitting/continuation behavior; import acceptance does not mean unlimited rows fit legibly on one slide.

Stored originals remain available even where previews use bounded excerpts. Some fallback excerpts are limited to 8,000 characters; generic text previews are bounded at 30,000 characters. These are preview/processing bounds, not a file rejection rule.

**Known copy inconsistency:** generic pasted text can still be labelled “Lecture notes ready”, and a material preview can use “Lecture context”. The underlying source need not be a lecture.

## 7. Slide workspace and project panels

### 7.1 Slide viewing

The slide is the dominant surface. The default workspace has a compact header, optional right sidebar, collapsible drawing tools, and horizontal filmstrip. There is no speech-control footer in View slides.

| ID | Control | Behavior |
| --- | --- | --- |
| VIEW-01 | Back | Return to projects. |
| VIEW-02 | Talk to generate | Highlighted entry to the speech creation/editing mode. |
| VIEW-03 | Practice | Start a new rehearsal from the current deck snapshot. |
| VIEW-04 | Present | Enter presenter mode and start input. |
| VIEW-05 | Audience | Toggle an inline clean audience preview; available outside presenter mode too. |
| VIEW-06 | Theme | Anchored choice of Paper, Midnight, or Lavender; mark selected choice; apply deck theme. |
| VIEW-07 | Settings | Open dedicated title and description editing. Changes save locally. Description is not part of the Context sidebar. |
| VIEW-08 | Export | Open an anchored PowerPoint/PDF menu, not the previous full export modal. |
| VIEW-09 | Sidebar | Rightmost header control; its pressed/filled-right-side treatment indicates whether the panel is open. |
| VIEW-10 | Slide overflow | The old floating add/move/delete menu above the canvas is removed; use the filmstrip. |

### 7.2 Sidebar

| Tab | Contents and behavior |
| --- | --- |
| Transcript | Show recorded speech segments and interim streamed words. Sketch context is not inserted into the speech transcript. |
| Context | Editable System prompt plus Materials. Source management remains available here. |

There is no redundant close button inside the sidebar; the header toggle controls it. Tab arrow keys and Home/End move between the two tabs. There is no Microphone or Input tab. There is only one speech input path: microphone. Settings and the ordinary sidebar are distinct panel states.

The direct legacy context page still contains older context fields and is reachable through secondary material-management UI. It should not be confused with the current streamlined Context tab.

## 8. Filmstrip, slide operations, and clipboard

| ID | Interaction | Behavior |
| --- | --- | --- |
| SLIDE-01 | Thumbnail | Render slide content with its number inside the thumbnail. No extra outside title row or checkbox. |
| SLIDE-02 | Selected slide | Strong border/selection treatment; accessible title and slide number remain available. |
| SLIDE-03 | Click thumbnail | Select slide, stop active input where applicable, and focus that thumbnail. |
| SLIDE-04 | Drag thumbnail | Reorder slides with before/after insertion feedback and edge scrolling. |
| SLIDE-05 | Right-click / Shift + F10 | Open slide context menu with add-before/add-after, copy, cut, paste, duplicate, delete, and undo actions. |
| SLIDE-06 | Add slide | Insert a blank slide with a new ID and current theme, then select it. |
| SLIDE-07 | Last selected slide / empty deck | In View slides and Talk, show a visible Add slide tile in the horizontal filmstrip when the last slide is selected or the deck is empty. Clicking inserts and selects a blank slide. The tile is absent when an earlier slide is selected. Presenter navigation stops at the end. |
| SLIDE-08 | Duplicate | Insert a distinct copy; new slide identity avoids sharing subsequent edits. |
| SLIDE-09 | Delete / Backspace | Remove the focused filmstrip slide, then clamp selection to a remaining valid slide. Do not delete while typing in a field. |
| SLIDE-10 | Ctrl/Cmd + C | Copy the current slide in creation/edit mode when not in an editable field. |
| SLIDE-11 | Ctrl/Cmd + X | Copy and remove the current slide. |
| SLIDE-12 | Ctrl/Cmd + V | Paste after the selected slide using a fresh ID. Cross-project paste clears source-material linkage. |
| SLIDE-13 | Alt + Left/Right | Reorder a focused thumbnail one position. |
| SLIDE-14 | Ctrl/Cmd + Z | Restore an app undo snapshot where available; history is limited to 30 snapshots and is not durable across route changes/reloads. |
| SLIDE-15 | Multiple selection | Not implemented. Operations address a single selected slide. |

Slide rendering supports title, bullets, process, comparison, quote, table, and code layouts. Rendered data stays separate from private source files. Reconciliation preserves table provenance when possible and invalidates it when edits no longer represent the original source exactly.

## 9. Talk to generate: audio and live editing



### 9.1 State and controls

| ID | State / action | Behavior |
| --- | --- | --- |
| TALK-01 | Enter mode | Request microphone recognition immediately; open Transcript. A browser permission prompt may still gate real microphone use. |
| TALK-02 | Pause / Resume or P | Stop/resume recognition. While connecting, the same control reads Cancel and cancels the pending session. |
| TALK-03 | Talk to audience | Treat speech as ordinary presentation content/navigation according to the local rule-based router. |
| TALK-04 | Talk to agent click | Latch instruction mode; clicking again returns to audience speech. Disabled before a slide exists. |
| TALK-05 | Hold Space | Temporarily talk to agent; release returns from the held mode. Does not capture Space while typing or activating a focused button/link. |
| TALK-06 | Agent visual state | Tint the UI, animate a border around the slide, and show a voice-reactive circle/live instruction transcript. Keep the slide visible. |
| TALK-07 | Mute or M | Stop capture; remember whether it was running. Unmute resumes where appropriate. |
| TALK-08 | Voice waveform | Reflect microphone amplitude when Web Audio access is available. No scripted sample waveform is exposed. Animation is not evidence of recognized words. |
| TALK-09 | Finish | Flush live edits, stop capture, and return to View slides. A deck with slides becomes Ready; an empty project remains Draft. |
| TALK-10 | Blur / route change | End held edit mode and stop stale recognition callbacks from changing another project/view. |

### 9.2 Microphone-only state machine

The implementation uses `SpeechRecognition` or `webkitSpeechRecognition`, with `continuous = true`, `interimResults = true`, and language `en-US`. No separate transcription server, API key, or model installation is needed. Browser support, HTTPS, permission, hardware and the browser vendor's recognition service remain dependencies. This is intentionally a small implementation.

| ID | Event / state | UI and data behavior |
| --- | --- | --- |
| MIC-01 | Enter Talk, Present or Practice | Attempt microphone startup once; open the appropriate transcript surface. Ordinary View slides never starts recording. |
| MIC-02 | Connecting | Show “Connecting microphone… Allow access when prompted”; the main control is Cancel, not Pause. Do not start rehearsal timing or claim Listening yet. |
| MIC-03 | Recognition onstart | Show Listening/Practicing, enable Pause, and start applicable session timing. |
| MIC-04 | Interim result | Display provisional words in the live transcript. Do not apply an interim instruction to the deck. |
| MIC-05 | Final result | Route a completed utterance to the selected speech purpose; record transcript/timing as appropriate. Agent-mode final speech applies the supported instruction. |
| MIC-06 | Pause / P | Abort capture, stop active timing and show Paused. Resume creates a new recognition session. |
| MIC-07 | Cancel while connecting | Abort the pending recognizer and clear the connection notice. Late callbacks from that recognizer are ignored. |
| MIC-08 | Mute / M | Stop capture. Remember whether speech was active or connecting; unmuting resumes only when appropriate. |
| MIC-09 | Permission or service denied | Stop; show a microphone-access instruction and Retry. No silent fallback to typed or sample speech. |
| MIC-10 | No microphone / network / no speech | Stop and explain the specific failure. Retry is offered only after the failed recognizer is cleared. |
| MIC-11 | Unsupported browser | Explain that recognition is unavailable and suggest Chrome/Edge. A Retry action cannot install browser support. |
| MIC-12 | Recognition ends | Return to a stopped state with “Microphone session ended. Resume when you are ready.” No endless automatic reconnection loop. |
| MIC-13 | Route/project/mode changes | Abort old capture. Validate recognizer identity, project, view and edit session before processing callbacks. |
| MIC-14 | Leaving the page | Stop recognition and audio-meter resources; attempt pending save. |
| MIC-15 | Live edit | Transcript field is read-only; voice is the only instruction input. Normal project forms, source text and notes remain editable. |
| MIC-16 | Privacy | Tell users the browser may use an online speech service. Raw microphone audio is not saved as a recording by this app; recognized transcript is saved locally. |

A microphone permission prompt may require a real click in the browser. Browser transcript quality and latency are outside this UI's control. Real-device audio and recognition accuracy were not validated in this pass; lifecycle behavior was tested with recognizer events and the connection/cancel flow was exercised in Chrome.

### 9.3 Supported edit and navigation intent

The parser is bounded and English-oriented. Examples describe supported intent patterns, not arbitrary natural-language understanding.

| Intent | Example | Result |
| --- | --- | --- |
| Current title | “Change the title to Database basics” | Replace selected title. |
| Body/content | “Set the content to …” | Replace selected content through the supported text operation. |
| Add a point | “Add a bullet …” | Append a supported point. |
| Replace wording | “Replace X with Y” | Apply recognized replacement. |
| Simplify | “Make this shorter” | Apply deterministic simplification. |
| Theme | “Use midnight theme” | Set recognized theme; scope phrases can target the entire deck. |
| Whole deck | “Use paper theme across the whole presentation” | Apply presentation-wide theme. |
| Layout | “Use comparison layout” | Convert to supported layout. |
| Specific slide | “On slide 3, change the title to …” | Resolve target and edit it. |
| Reorder | “Move slide 3 before slide 2” | Reorder while preserving selected slide identity. |
| Navigation | “Next slide”, “Go back”, “Go to slide 4” | Move to a valid slide; out-of-range requests stay put with feedback. |
| Named table | “Show the Customers table” | Resolve stored source and show its data. |

Routing prioritizes named material references, then explicit live-edit intent, then contextual navigation during presentation, then general local template interpretation. Ambiguous slide titles/table names do not silently select an arbitrary target. A recognized but unsupported command should produce feedback rather than become accidental slide narration.

Existing-slide following supports explicit next/previous/first/last/numeric/title references. Contextual advancement needs transition language and a sufficiently specific topic match. Incidental mentions alone should not switch slides. Negated navigation is ignored. Practice associates explanation after a navigation instruction with the destination slide.

## 10. Annotation palette and held shortcuts

| ID | Interaction | Behavior |
| --- | --- | --- |
| INK-01 | Palette | Collapsed dark Draw launcher by default. Click to reveal the vertical pen/highlighter/eraser tools; drag the grip to reposition. Close returns to the pointer. Expansion preference survives view rerenders during the session. |
| INK-02 | Main tool click | Activate/deactivate that drawing tool without opening its options. |
| INK-03 | Corner arrow | Open color/thickness choices for pen or highlighter. |
| INK-04 | D held | Temporarily select pen, overriding the clicked tool. |
| INK-05 | H held | Temporarily select highlighter, overriding the clicked tool. |
| INK-06 | E held | Temporarily select object eraser, overriding the clicked tool. |
| INK-07 | Release shortcut | Return to the pointer; do not restore the clicked tool. Shortcuts are ignored in text fields and open menus/dialogs, and with Ctrl, Command, or Alt. |
| INK-08 | Erase contact | Remove an entire intersected stroke, not individual pixels. Hit tolerance is about 12 CSS pixels. |
| INK-09 | Visual marks | Show the freehand stroke only; no selection rectangle. Display only the number of marks in status. |
| INK-10 | Scope context | Calculate marked-area bounds and intersecting semantic slide content internally for the next edit. Do not add a context card to Transcript. |
| INK-11 | Change slide | Unlatch current tool; keep existing marks in the per-slide memory map. |
| INK-12 | Escape / blur | Deactivate temporary drawing state without deleting existing strokes. |
| INK-13 | Persistence | Marks are in-memory for the active page; reload loses them. They are not part of exported or audience slide output. |
| INK-14 | Bounds | Up to 100 strokes per slide; long point arrays are reduced above 2,048 points; normalized coordinates support resizing. |
| INK-15 | Practice | The current practice renderer does not mount the annotation palette. |

Tool shortcuts are guarded around editable fields, dialogs, audience overlays, and fullscreen states. OS/browser-reserved shortcuts may take precedence on some machines; Windows/Linux hardware behavior was not manually tested in this review.

## 11. Presenter mode


| ID | Element / trigger | Behavior |
| --- | --- | --- |
| PRES-01 | Layout | Large current slide, right-hand next-slide preview, editable speaker notes, transcript disclosure, compact header/footer. |
| PRES-02 | Entry | Request microphone recognition automatically when a deck exists; timing starts after recognition confirms onstart. |
| PRES-03 | Next preview | Show the upcoming slide; clicking advances. Last slide shows end-of-presentation information. |
| PRES-04 | Previous / Next | Navigate manually; disable boundary actions. Arrow keys also navigate outside fields. |
| PRES-05 | Speech | Follow recognized navigation/context; explicit supported edit commands can still be interpreted by the shared speech router. |
| PRES-06 | Pause / Resume, P | Control presentation speech input. |
| PRES-07 | Mute, M | Toggle capture. |
| PRES-08 | Black screen, B | Toggle the black audience output state. |
| PRES-09 | Fullscreen, F | Use browser fullscreen where possible, with an application fallback. Hide editor chrome/footer and use the viewport for the slide. |
| PRES-10 | Audience, A | Open clean inline audience view; offer a separate audience window. |
| PRES-11 | End, Esc | Stop presentation and return to slide view; publish ended status. When native fullscreen is active, Escape first belongs to fullscreen exit. |
| PRES-12 | Lock / hold | No lock/hold control is exposed. Legacy code paths are not a supported visible feature. |
| PRES-13 | Push to edit | No push-to-edit button or Space edit interaction in presenter mode. |
| PRES-14 | Filmstrip | Hidden in presenter view. |

Notes, transcript, source context, settings, and rehearsal feedback are presenter-private. The separate audience output receives the slide payload, not those panels.

## 12. Audience display and fullscreen


| ID | Behavior | Specification |
| --- | --- | --- |
| AUD-01 | Inline preview | Cover the workspace with the current slide; underlying application controls are made inert. Return with A/Escape or the visible Return control. |
| AUD-02 | Availability | Available while viewing, generating, presenting, and practicing once slides exist. |
| AUD-03 | Separate window | Open audience.html with project ID; show only audience-appropriate content and fullscreen affordance. |
| AUD-04 | Transport | BroadcastChannel and local-storage events on the same origin synchronize output. This is not a network collaboration service. |
| AUD-05 | Startup | Read the latest valid matching payload; show a waiting state if no output exists. |
| AUD-06 | Black / ended | Render black when requested; show presentation-ended state for inactive output. |
| AUD-07 | Payload safety | Match project identity and timestamps, and sanitize rendered slide data. |
| AUD-08 | Cross-device limit | Opening the audience URL on a different device/profile does not retrieve the presenter's local project. |
| AUD-09 | Abrupt disconnect | A closed/crashed presenter can leave the last cached slide visible; there is no network heartbeat expiry. |
| AUD-10 | Aspect ratio | Preserve slide composition while fitting available viewport; differing screen ratios can leave surrounding space. |

## 13. Practice phase 1 — rehearsal capture


| ID | Event / state | Behavior |
| --- | --- | --- |
| PRA-01 | Start practice | Snapshot the current deck and create a new rehearsal session. Retain up to three prior sessions in history data. |
| PRA-02 | Automatic input | Request microphone recognition without a second Start click; permission limits still apply. Connecting has Cancel; capture starts only on recognition onstart. |
| PRA-03 | Screen | Current slide, next slide, notes disclosure, live Transcript, input selector, elapsed time, speech controls, navigation. |
| PRA-04 | Transcript | Capture actual recognized words, not a prewritten explanation panel masquerading as transcription. |
| PRA-05 | Attribution | Associate each transcript interval with a stable slide ID and start/end time. |
| PRA-06 | Manual navigation | Commit the current captured phrase before changing slides; subsequent speech belongs to the selected slide. |
| PRA-07 | Automatic navigation | Use explicit or recognized contextual transitions; do not mutate the rehearsal snapshot through edit commands. |
| PRA-08 | Pause | Stop capture timing accumulation while explicitly paused. Silence within a running interval remains part of elapsed rehearsal time. |
| PRA-09 | Last slide | Navigation offers review/finish behavior rather than adding another rehearsal slide. |
| PRA-10 | Finish practice | Stop input, flush pending words, build deterministic feedback/suggestions, save session, and open Overview. |
| PRA-11 | Recording format | Store transcript intervals and slide snapshot, not an audio recording or phoneme/word-level acoustic timeline. |
| PRA-12 | Practice again | Create a new rehearsal from the current deck, including previously approved changes. |

There is no sample practice mode. Suggestions depend on captured speech and supported local rules. An unrehearsed slide has no invented transcript. Historical saved sample/typed sessions may still exist; preserving user data does not make those input modes available again.

## 14. Practice phase 2 — overview and delivery feedback


### 14.1 Metrics and levels

| Section | Calculation / rule | Display |
| --- | --- | --- |
| Rehearsal time | Accumulated running capture time; explicit paused periods do not advance it. | Minutes:seconds. |
| Slides rehearsed | Count slides with captured speech against snapshot slide count. | Covered / total. |
| Words per minute | Transcribed word count divided by elapsed rehearsal minutes. | Rounded overall pace. |
| Pace — No data | No captured words. | No-data feedback. |
| Pace — Measured | Under 100 words/minute. | Amber guidance to develop/maintain explanation. |
| Pace — Steady | 100–180 words/minute, inclusive. | Green pace feedback. |
| Pace — Fast | Over 180 words/minute. | Amber guidance to slow down/pause. |
| Clarity — Needs attention | One or more matched vague passages. | Attention treatment and count. |
| Clarity — Keep in mind | No matched vague passage. | Neutral guidance; not a claim of perfect clarity. |
| Tone & emphasis — Coaching tip | Generic contextual coaching. | Neutral coaching, explicitly not a measured vocal-tone score. |

These are prototype heuristics, not validated speaking-assessment thresholds. Tone, pitch, stress, confidence, pronunciation, and prosody are not acoustically scored.

### 14.2 Speech-speed timeline

The panel shows estimated words/minute over rehearsal time. It uses windows of at least five seconds, increasing window size for longer sessions to keep roughly forty intervals. A very short final tail can be merged. Words are apportioned across a transcript segment's time span; gaps can produce zero-speed windows. Accessible interval labels expose the range and estimated WPM.

This is an approximation based on phrase timing. It does not have exact word timestamps, so it must not be interpreted as precise moment-by-moment vocal speed.

### 14.3 Clarity rules

Examples matched by the heuristic include “this thing”, “that thing”, “usual stuff”, “usual way”, “it just works”, “and all that”, “and so on”, “somehow”, “stuff”, “kind of”, “sort of”, “this part”, and “over here”. At most three matches per segment are highlighted. Comments tie the phrase to slide content where possible: table columns, keys, SQL conditions, transaction outcomes, or application/DBMS roles.

If a segment only repeats the heading, feedback asks for an explanation. Naming an actual term can generate a Keep comment. Unrehearsed slides receive no invented transcript feedback. The first comment is shown prominently, with additional comments available through disclosure controls.

## 15. Slide changes — visual diff and decisions



| ID | Interaction / state | Behavior |
| --- | --- | --- |
| REV-01 | Enter Slide changes | Always select slide 1 and reset the suggestion cursor. |
| REV-02 | Previous / Next | Navigate snapshot slides; show current number and title. |
| REV-03 | Navigation badges | Count pending suggestions in all earlier or later slides, not merely the immediately adjacent slide. |
| REV-04 | Before | Render rehearsed original with a strong red comparison border and red marks on removed/changed text. |
| REV-05 | After | Render suggested result with a strong green border and green marks on added/changed text. |
| REV-06 | Redundant captions | No “As rehearsed” / “Accepted change” secondary caption beside the main labels. |
| REV-07 | Text diff | Do not show the old separate raw text-diff block; mark changes on the slide previews. |
| REV-08 | Suggestion explanation | State the proposed change and why it helps. |
| REV-09 | Approve / Reject | Equal-weight horizontal controls; green Approve, light-red Reject; concise labels. |
| REV-10 | Approve | Apply supported changes to the live project and persist decision. Rehearsal snapshot remains available as Before. |
| REV-11 | Reject | Persist rejection without changing live slides. |
| REV-12 | Approved state | Green decision badge; After marked Applied; Before marked Original and visually subdued. |
| REV-13 | Rejected state | Red decision badge; Before marked Kept; After marked Not applied and visually subdued. |
| REV-14 | Unchosen option | Reduce saturation/opacity while retaining readability and comparison context. |
| REV-15 | Multiple suggestions | Review pending proposals one at a time; advance to the next pending proposal when appropriate. |
| REV-16 | Supported proposal types | Field updates, splitting a slide, and reordering. Split/reorder changes expose additional relevant structure. |
| REV-17 | Already decided | Prevent applying the same suggestion again. No direct reverse-decision action is exposed. |
| REV-18 | Stale proposal | Refuse approval if target was removed, affected content changed, material dependencies changed, order assumptions changed, or split target conflicts. Show actionable feedback instead of overwriting newer work. |
| REV-19 | Unrelated changes | Changes to fields not affected by the proposal need not invalidate it. |
| REV-20 | No suggestion | Show current slide and relevant transcript feedback; do not invent a structural change. |
| REV-21 | Unrehearsed slide | Show “Not rehearsed yet” / no captured speech guidance. |
| REV-22 | Transcript | Show that slide's time interval, exact words, highlighted vague phrases, and related comments below the slide comparison. |
| REV-23 | End with pending changes | Offer Review remaining and take the user to pending work. |
| REV-24 | No pending changes | Show a highlighted Done control to the right of the Overview / Slide changes row, below the header. |

Decision state uses text and icons in addition to color. The proposed-but-rejected content remains visible for understanding, but clearly marked as not applied.

## 16. Review completion


1. Done opens the completion screen once all suggestions are resolved.
2. Show a success mark, “Review complete”, and confirmation that decisions are saved.
3. Show separate green Approved and red Rejected totals.
4. If applicable, show how many slides were not rehearsed.
5. Offer **Practice again** to start a new rehearsal and **Done** to return to View slides.
6. Do not offer “Back to review” as the main completion path.
7. Final Done records completion time and returns to editing; accepted slide changes remain saved.

Completion means the suggestion workflow is finished. It does not imply every slide was rehearsed or that the lecture is objectively ready.

## 17. Export behavior

| Format | Current implementation | Boundaries |
| --- | --- | --- |
| PowerPoint `.pptx` | Client-side export using bundled PptxGenJS; wide slides; convert rendered text and supported shapes/backgrounds into editable objects; include notes. | Font/layout fidelity can vary in desktop PowerPoint. Not every browser-rendered feature maps perfectly. |
| PDF `.pdf` | Render each slide to a PNG and place it on a PDF page through jsPDF. | Raster output; slide text is not exported as fully editable/searchable vector text. |
| Google Slides | Import the exported PPTX manually. | No direct Google Slides authentication/upload integration. |

The visible export menu contains PPTX and PDF. It does not expose the older HTML/JSON project export choices. Exports do not include private material files, transcript, feedback, or in-memory sketches. Runtime dependencies are bundled; no separate server-side conversion is required. Native desktop opening of every exported layout was not re-tested in this pass.

## 18. Keyboard specification

Unless noted, typing fields, dialogs, editable controls, and active overlays take priority. Focused buttons also keep their normal keyboard activation behavior.

| Key / combination | Context | Action |
| --- | --- | --- |
| `/` | Dashboard, outside input | Focus search. |
| Ctrl/Cmd + K | Dashboard | Focus/select search. |
| Up / Down / Home / End | Folder tree | Navigate visible folders. |
| Left / Right | Folder tree | Collapse/parent or expand/child. |
| Left / Right / Home / End | Sidebar tablist | Select a sidebar tab. |
| Left / Right | Slide modes, outside fields | Previous/next slide or review navigation. |
| Shift + F10 | Filmstrip | Open context menu. |
| Alt + Left / Right | Focused thumbnail | Move slide earlier/later. |
| Delete / Backspace | Focused thumbnail | Delete slide. |
| Ctrl/Cmd + C / X / V | Create/edit, outside text editing | Copy/cut/paste a slide. |
| Ctrl/Cmd + Z | Supported project states | Undo latest available app change. |
| P | Talk, present, practice | Pause/resume speech. |
| M | Talk, present, practice | Mute/unmute. |
| Hold Space | Talk mode only | Temporary agent instruction mode. |
| Hold D | Drawing-enabled canvas | Temporary pen. |
| Hold H | Drawing-enabled canvas | Temporary highlighter. |
| Hold E | Drawing-enabled canvas | Temporary object eraser. |
| F | Supported slide/presenter states | Toggle fullscreen; only effective where the action is enabled. |
| A | Non-empty slide modes | Toggle audience preview. |
| B | Presenter | Toggle black output. |
| Escape | Menu/dialog/overlay/edit/fullscreen | Close or exit the active transient layer before broader navigation. |
| Escape | Presenter after fullscreen/overlay exit | End presentation. |

There is no current L lock shortcut because the lock feature was removed. Browser/OS reserved key behavior needs separate cross-platform validation.

## 19. Saving, state transitions, and failure behavior

| ID | Area | Behavior |
| --- | --- | --- |
| DATA-01 | Workspace | Save folders, project metadata, slides, material metadata, and practice data to IndexedDB. |
| DATA-02 | File originals | Store blobs separately in IndexedDB and link by material ID. |
| DATA-03 | Autosave | Debounce ordinary edits by roughly 300 ms; critical operations save immediately. |
| DATA-04 | Save failure | Report unsaved state; transactional operations attempt rollback rather than falsely showing success. |
| DATA-05 | Leaving page | Warn if saving/unsaved data or an upload operation remains; pagehide stops input and attempts pending persistence. |
| DATA-06 | Workspace load failure | Show an error screen and Try again. |
| DATA-07 | Route change | Stop recognition/streams/timers; flush edits; reset transient selection/panels/undo/mute/black/fullscreen state as appropriate. |
| DATA-08 | Stale callbacks | Recognition callbacks validate project, view, and edit session before applying content. |
| DATA-09 | Audience output | Store sanitized current-slide payload separately and send through same-origin BroadcastChannel. |
| DATA-10 | Browser origin | Local data belongs to the exact scheme/hostname/port and browser profile. Changing hostname creates a different workspace origin. |
| DATA-11 | Undo | In-memory history, capped at 30; not a version-control system or durable history. |
| DATA-12 | Practice history | Keep a bounded history of three previous sessions in data; there is no complete history-browser UI. |
| DATA-13 | Annotation state | In-memory per project/slide; not persisted after reload. |
| DATA-14 | Authentication | None. No accounts, workspace permissions, or remote project database. |

**Hosting and storage:** the permanent public site continues serving when this computer is off. Projects still live in browser storage, not in the hosting service. The permanent hostname cannot automatically read projects saved under an old tunnel hostname. Clearing browser storage removes local data; full workspace migration is not implemented.

## 20. Interaction, accessibility, and layout rules

- Keep the slide as the primary visual surface; use the right panel only when requested or required by talk mode.
- Keep slide viewing, talk generation, practice, and presentation visibly distinct rather than displaying every control in every mode.
- Use bundled Lucide icons and actual shadcn/ui React buttons, inputs, textareas and tabs, with Radix interaction primitives and Tailwind styling. Custom slide layouts, native dialogs/file inputs/selects and JavaScript application logic remain; this is a component-layer migration, not a full React rewrite.
- Provide accessible names for icon controls, visible focus outlines, semantic regions, tab selection state, and pressed state for toggles.
- Use text/icon status alongside color for review decisions and selected controls.
- Menus are anchored to their trigger, kept inside the viewport, keyboard navigable, and dismissed by Escape/outside interaction.
- Standard dialogs support close/Cancel and outside dismissal; do not discard in-progress busy saves mid-operation.
- Reduced-motion preference suppresses selected animated effects; this is not a full motion-accessibility certification.
- Responsive layout rules reduce/reflow panels and controls at narrower widths. Horizontal filmstrips scroll rather than squeezing every slide into view.
- The implemented product is desktop-oriented. Touch drawing, phone-sized editing, screen-reader workflows, zoom, and all color combinations require additional dedicated testing.
- Changing the UI background must not accidentally recolor slide text/code blocks. Source previews and slide canvases have separate visual roles.


## Final implementation rules that resolve ambiguity

1. Plain held D/H/E only, no Ctrl/Command/Alt. D pen,H highlighter,E object eraser. These override any clicked tool and releasing the held key returns to pointer, never the previous latch. Last pressed eligible held key wins; releasing it returns pointer rather than restoring older held keys. Main tool click again cancels. Drawing shortcuts only in canvas routes outside text fields, menus and dialogs; not audience/fullscreen/practice. Modifiers cancel held tools. Escape/blur/routes clean up. Commit an in-progress stroke before changing effective tool; pointer cancel discards incomplete stroke.
2. Object erase removes whole stroke hit within12px of a segment. Store normalized points with tool/color/width per project+slide in memory, max100strokes, cap2048points by downsampling retaining appearance. Highlight width5×pen width, opacity.28. Pen defaults3px. Pointer capture plus document fallback; DPR cap3. No rectangle or context text in transcript. No sketches in audience/export.
3. Speech is real browser recognition, but semantic generation/review is deterministic local logic. Narration creates title/bullet slides from finalized sentences; break into a new slide on explicit “next slide” or a short focused content threshold. Agent commands update targeted stable slide. Support title change, add bullet, replace X with Y, shorten, theme deck, switch to slide N/title, comparison, move slide N before M, and named imported table. Ambiguous references keep current content and provide a short nonblocking hint. Practice recognizes navigation only and never mutates snapshot.
4. Sources support any file as attachment. Parsing should not reject the upload: CSV handles quoted delimiters/newlines; JSON accepts records,columns/rows,tables wrapper; other structures stay references. Never silently truncate original data; paginate rendering. Preview truncation is visual only and download original remains exact.
5. Feedback is honest: WPM from words/active duration; <100 measured,100–180 steady,>180 fast. No data when absent. Tone neutral coaching only, no invented acoustic score. Suggested patches are tied to rehearsal snapshot and reject stale dependencies; acceptance exactly once. Unrehearsed slides have no fabricated feedback.
6. Initial state is blank. Do not silently seed samples or auto-open microphone on project creation. Entering Talk opens transcript and requests recognition; denied access offers Retry, not sample speech. Final Finish saves/returns without inventing slides.
7. Existing source text or files must never become executable HTML. Escape content and sanitize audience transport. All windows synchronize same-origin only; there is no cross-device backend.

## Deterministic reproduction fixture (test-only, not product onboarding)

Create a fixture in tests with folders Presentations (child Product launches) and Ideas & experiments. Project “Introduction to Database Systems”, description “A first-year lecture using a fictional café dataset.” System prompt “Teach database fundamentals to beginners using the provided fictional café example. Keep one idea per slide. Preserve exact sample rows and SQL results.” Attach customers.csv with customer_id,name rows 1,Linh / 2,Minh / 3,An; orders.csv with order_id,customer_id,total_usd rows101,1,5.50 /102,2,3.00 /103,1,8.00; notes.txt explaining keys and transactions. Use Paper theme.

Create twelve test slides:
1 title “Introduction to Database Systems”, body “A café, three customers, and the data behind every order.”
2 bullets “Questions for our first database lesson”: Who placed each order? / Which orders total at least $5? / How do we keep related changes together?
3 process “Database and database software”: Application: Sends a query / DBMS: Processes the request / Database: Stores the organized records.
4 table “Customer records: rows and columns”, Customers full table.
5 table “Orders refer to a customer”, Orders full table.
6 comparison “Keys connect the tables”: Customers · one: customer_id is the primary key / Orders · many: customer_id is a foreign key.
7 process “Four everyday data operations”: Create: INSERT a new order / Read: SELECT matching orders / Update: UPDATE an order total / Delete: DELETE a record.
8 code “SQL: find orders of $5 or more”: SELECT order_id, total_usd\nFROM orders\nWHERE total_usd >= 5\nORDER BY order_id; results101→$5.50,103→$8.00.
9 code “JOIN connects related rows”: SELECT c.name, o.order_id\nFROM customers c\nJOIN orders o ON c.customer_id = o.customer_id;
10 process “A transaction keeps changes together”: Begin: Start the transaction / Change: Save order + reduce stock / Finish: COMMIT all, or ROLLBACK.
11 bullets “Tables, keys, queries, transactions”: Tables organize records / Keys connect records / Queries retrieve data / Transactions group changes.
12 bullets “Read the café’s data”: Which customer placed orders101 and103? / Why can an order not refer to customer99? / What should happen if half a checkout fails?

Test rehearsal slide1 transcript 0–12s: “Today we are learning database systems. We will read tables, identify keys, use SELECT and JOIN, and explain transactions. That gives us the basics and all that.” Suggest visible learning outcomes (Read tables and identify keys / Use SELECT and JOIN / Explain transactions), highlight “and all that” as vague. Slide3 transcript “The café app sends a request to the DBMS. The DBMS reads or changes the stored data. This thing does the work between our screen and the database.” Suggest shorter process labels; highlight vague phrase. Slide10: “Checkout saves an order and reduces stock inside one transaction. If one database change fails, it just works.” Suggest comparison COMMIT: Keep all grouped database changes / ROLLBACK: Discard the grouped database changes; highlight vague phrase. Other unrehearsed slides remain unrehearsed. Do not show fixture controls in runtime.

## Build sequence and acceptance gate

Implement model/storage and shared slide renderer first; dashboard/setup/sources second; slide workspace/manipulation third; speech lifecycle and intent routing fourth; audience/presenter fifth; drawing sixth; practice/review seventh; exports and accessibility last. Verify integrated flows, not only pure functions. Use tests for command boundaries, stale sessions, storage recovery, review acceptance and clipboard identities. Use browser tests for visible state, routing, menus, focus and geometry.

Required acceptance:
- Fresh browser empty dashboard; create project with default Untitled1; copied text/file source; reload persists; cancel creates nothing.
- Nested folder browse/create/collapse/search and keyboard routes; project menu does not open card accidentally.
- No speech footer in view slides; dark centered onboarding; last-slide Add slide; drag/reorder/clipboard/delete/undo preserve selection and uniqueIDs.
- Talk starts recognition automatically, transcript opens; simulated recognition adapter only in tests verifies interim/final dedup, pause/resume,mute,Space,Finish,error/cancel/stale callbacks. Actual microphone test separately recorded or explicitly untested.
- D/H/E override, key release pointer, repeated click off; no shortcut in inputs or menus; erase whole object; palette drag/reclamp; colors open only corner.
- Audience fills viewport without footer, live sync, B black, F fullscreen,A toggle,Esc route/focus behavior; no private material or transcript leaks.
- Practice snapshot unaffected by speech; overview timing/chart/levels; slidechanges first slide; red/green marks only changed content; approve/reject persistent; stale rejection; pending counts; Done/completion/Practice again.
- PPTX/PDF files open and contain every slide; filenames safe; source files/transcript excluded.
- At1512×900 and786×853 capture dashboard,setup,empty,slides,Talk,Context,palette,presenter,audience,overview,diff,completion. Also check390px overflow. No clipped menus, light text on light code blocks, duplicate controls or undiscoverable focus.

Deliver runnable app, lockfile, tests, screenshots, interaction inventory and limitations. Do not claim pixel-perfect or full production readiness merely because build passes. A screenshot comparison against a separately supplied reference is needed for that claim.

## Slide renderer reference CSS

The following self-contained CSS is a normative layout reference for the shared slide renderer. Reproduce its semantic DOM (slide-frame > slide theme-* layout-* > heading/body/signature) or adapt selectors without changing measurements. It is included in this prompt so no prior files are required.

```css
/* Shared slide renderer. Place each slide in a .slide-frame with a 16:9 ratio. */
.slide-frame{container-type:inline-size;position:relative;overflow:hidden;background:#fff;isolation:isolate}
.slide-page,.slide-page *{box-sizing:border-box}
.slide-page{--slide-bg:#fff;--slide-ink:#25272c;--slide-muted:#737782;--slide-accent:#5268de;--slide-soft:#f1f3fc;--slide-line:#e4e6eb;position:relative;width:100%;height:100%;aspect-ratio:16/9;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:6.2cqw 7cqw;background:var(--slide-bg);color:var(--slide-ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;text-align:left;line-height:1.28}
.slide-page.slide-theme-midnight{--slide-bg:#222631;--slide-ink:#f6f7fb;--slide-muted:#b6bdcc;--slide-accent:#b2bbff;--slide-soft:#303647;--slide-line:#454c60}
.slide-page.slide-theme-lavender{--slide-bg:#f0effa;--slide-ink:#302e43;--slide-muted:#78738e;--slide-accent:#6957b4;--slide-soft:#e4e0f4;--slide-line:#d3cee8}
.slide-page h2,.slide-page h3,.slide-page p{margin:0;font:inherit}
.slide-page .slide-heading{max-width:100%;font-size:4.8cqw;line-height:1.12;font-weight:620;letter-spacing:-.19cqw;overflow-wrap:anywhere;text-wrap:balance}
.slide-page .slide-body{font-size:2.2cqw;line-height:1.48;overflow-wrap:anywhere}
.slide-page .slide-signature{position:absolute;left:7cqw;right:7cqw;bottom:3.6cqw;display:flex;align-items:center;justify-content:space-between;gap:2cqw;font-size:1.05cqw;line-height:1;color:var(--slide-muted)}
.slide-page .slide-signature::before{content:"";display:block;width:2.8cqw;height:.24cqw;min-height:1px;background:var(--slide-accent)}
.slide-page .slide-marker{height:3.7cqw;width:3.7cqw;border:1px solid var(--slide-line);border-radius:50%;position:absolute;top:4cqw;right:4.7cqw}
.slide-page .slide-marker::after{content:"";position:absolute;inset:1.15cqw;border-radius:50%;background:var(--slide-accent)}
.slide-page.slide-layout-title{justify-content:center;padding-right:15cqw}
.slide-layout-title .slide-heading{font-size:7cqw;letter-spacing:-.32cqw;line-height:1.05;max-width:90%}
.slide-layout-title .slide-lead{margin-top:3.3cqw;max-width:72cqw;color:var(--slide-muted);font-size:2.25cqw;line-height:1.45}
.slide-layout-title .slide-title-details{margin-top:2cqw;display:flex;flex-wrap:wrap;gap:1cqw 2cqw;list-style:none;padding:0;color:var(--slide-muted);font-size:1.5cqw;line-height:1.4}
.slide-layout-title .slide-title-details li+li{padding-left:2cqw;border-left:1px solid var(--slide-line)}
.slide-layout-bullets .slide-heading{margin-bottom:4cqw;max-width:83%}
.slide-layout-bullets .slide-list{list-style:none;margin:0;padding:0;display:grid;gap:2cqw}
.slide-layout-bullets .slide-list li{display:flex;align-items:baseline;gap:1.6cqw;font-size:2.4cqw;line-height:1.4;overflow-wrap:anywhere}
.slide-layout-bullets .slide-list li::before{content:"";flex:none;width:.65cqw;height:.65cqw;border-radius:50%;background:var(--slide-accent);transform:translateY(-.2cqw)}
.slide-layout-bullets.slide-many .slide-list{grid-template-columns:1fr 1fr;column-gap:4cqw}
.slide-layout-process .slide-heading{margin-bottom:5cqw;max-width:90%}
.slide-process{display:grid;grid-template-columns:repeat(var(--slide-count,3),minmax(0,1fr));gap:2.3cqw;list-style:none;padding:0;margin:0}
.slide-process li{position:relative;min-width:0;border-top:1px solid var(--slide-line);padding-top:2cqw}
.slide-process .slide-step{display:inline-flex;align-items:center;justify-content:center;width:4.5cqw;height:4.5cqw;border-radius:50%;background:var(--slide-soft);color:var(--slide-accent);font-size:1.7cqw;font-weight:550;margin-bottom:2.2cqw}
.slide-process h3{font-size:2.7cqw;line-height:1.15;font-weight:600;letter-spacing:-.06cqw;overflow-wrap:anywhere}
.slide-process p{font-size:1.6cqw;line-height:1.45;color:var(--slide-muted);margin-top:1.3cqw;overflow-wrap:anywhere}
.slide-layout-comparison .slide-heading{margin-bottom:4cqw;max-width:90%}
.slide-comparison{display:grid;grid-template-columns:repeat(var(--slide-count,2),minmax(0,1fr));gap:2.8cqw}
.slide-comparison article{border-top:2px solid var(--slide-line);padding:2.7cqw 0 0;min-width:0}
.slide-comparison article:last-child{border-color:var(--slide-accent)}
.slide-comparison h3{font-size:3cqw;font-weight:600;line-height:1.2;letter-spacing:-.08cqw;overflow-wrap:anywhere}
.slide-comparison p{font-size:2cqw;line-height:1.5;color:var(--slide-muted);margin-top:2.2cqw;overflow-wrap:anywhere}
.slide-comparison ul{padding-left:2cqw;font-size:2cqw;line-height:1.5;color:var(--slide-muted);margin:2cqw 0 0}
.slide-layout-quote .slide-quote-mark{font-size:10cqw;line-height:.8;color:var(--slide-accent);margin-bottom:1.5cqw;letter-spacing:-1cqw}
.slide-layout-quote .slide-heading{font-size:5.6cqw;line-height:1.2;letter-spacing:-.22cqw}
.slide-layout-quote .slide-attribution{margin-top:3cqw;font-size:1.8cqw;color:var(--slide-muted);line-height:1.4;overflow-wrap:anywhere}
.slide-page.slide-dense .slide-heading{font-size:3.7cqw;letter-spacing:-.12cqw;line-height:1.16}
.slide-page.slide-dense.slide-layout-title .slide-heading{font-size:5.2cqw;letter-spacing:-.2cqw}
.slide-page.slide-dense .slide-lead,.slide-page.slide-dense .slide-list li{font-size:1.8cqw}
.slide-page.slide-dense .slide-process h3,.slide-page.slide-dense .slide-comparison h3{font-size:2.1cqw}
.slide-page.slide-dense .slide-process p,.slide-page.slide-dense .slide-comparison p,.slide-page.slide-dense .slide-comparison ul{font-size:1.5cqw}
.slide-page.slide-dense .slide-heading{margin-bottom:2.8cqw}
.slide-page.slide-dense .slide-list{gap:1.2cqw}
.slide-page.slide-dense .slide-process{gap:1.7cqw}
.slide-page.slide-dense .slide-step{width:3.7cqw;height:3.7cqw;margin-bottom:1.4cqw}
.slide-page.slide-very-dense{padding-top:4.7cqw;padding-bottom:6cqw}
.slide-page.slide-very-dense .slide-heading{font-size:3.2cqw;margin-bottom:2cqw}
.slide-page.slide-very-dense .slide-list li,.slide-page.slide-very-dense .slide-lead{font-size:1.55cqw;line-height:1.35}
.slide-page.slide-very-dense .slide-process p,.slide-page.slide-very-dense .slide-comparison p,.slide-page.slide-very-dense .slide-comparison ul{font-size:1.25cqw;line-height:1.35}

/* Data remains editable as plain text; table rows use pipe-separated cells. */
.slide-layout-table .slide-heading,.slide-layout-code .slide-heading{margin-bottom:3.5cqw;max-width:90%}
.slide-table{width:100%;table-layout:fixed;border-collapse:collapse;text-align:left;font-size:2.05cqw;line-height:1.35}
.slide-table th,.slide-table td{padding:1.6cqw 1.8cqw;border-bottom:1px solid var(--slide-line);overflow-wrap:anywhere;vertical-align:top}
.slide-table th{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:1.6cqw;font-weight:600;color:var(--slide-accent);background:var(--slide-soft)}
.slide-table td{font-variant-numeric:tabular-nums}
.slide-table tbody tr:last-child td{border-bottom:2px solid var(--slide-line)}
.slide-code{margin:0;padding:2.2cqw 2.5cqw;background:var(--slide-soft);border-left:.35cqw solid var(--slide-accent);border-radius:0 .6cqw .6cqw 0;color:var(--slide-ink);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:1.9cqw;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
.slide-code code{font:inherit}
.slide-code-results{margin-top:2cqw;display:grid;gap:.8cqw;font-size:1.8cqw;color:var(--slide-muted);line-height:1.4}
.slide-code-results p{overflow-wrap:anywhere;white-space:pre-wrap}
.slide-page.slide-dense .slide-table{font-size:1.8cqw}
.slide-page.slide-dense .slide-table th{font-size:1.45cqw}
.slide-page.slide-dense .slide-table th,.slide-page.slide-dense .slide-table td{padding:1.2cqw 1.6cqw}
.slide-page.slide-dense .slide-code{font-size:1.65cqw;line-height:1.45}
.slide-page.slide-dense .slide-code-results{font-size:1.6cqw}
.slide-page.slide-very-dense .slide-table{font-size:1.55cqw}
.slide-page.slide-very-dense .slide-table th,.slide-page.slide-very-dense .slide-table td{padding:.85cqw 1.3cqw}
.slide-page.slide-very-dense .slide-code{font-size:1.4cqw}
.slide-page.slide-very-dense .slide-code-results{font-size:1.4cqw;margin-top:1.4cqw}
/* Imported tables retain complete cell values. Longer datasets are paginated. */
.slide-imported-table .slide-table th,.slide-imported-table .slide-table td{white-space:pre-wrap}
.slide-page .slide-table-source{font-size:1.1cqw;line-height:1.4;color:var(--slide-muted);margin-top:1.4cqw;overflow-wrap:anywhere}
.slide-page.slide-imported-table.slide-table-compact{padding:4cqw 5cqw 6cqw}
.slide-page.slide-imported-table.slide-table-compact .slide-heading{font-size:3.5cqw;line-height:1.14;margin-bottom:2cqw}
.slide-page.slide-imported-table.slide-table-compact .slide-table{font-size:1.35cqw;line-height:1.3}
.slide-page.slide-imported-table.slide-table-compact .slide-table th{font-size:1.15cqw;line-height:1.3}
.slide-page.slide-imported-table.slide-table-compact .slide-table th,.slide-page.slide-imported-table.slide-table-compact .slide-table td{padding:.45cqw .65cqw}
.slide-page.slide-imported-table.slide-table-compact .slide-table-source{font-size:1cqw;margin-top:1cqw}
.slide-page.slide-thumbnail{pointer-events:none;user-select:none}
@media(prefers-reduced-motion:reduce){.slide-page,.slide-page *{animation:none!important;transition:none!important}}

.slide-page .slide-marker{display:none}.slide-page .slide-heading{letter-spacing:-.1cqw}.slide-layout-title .slide-heading{letter-spacing:-.2cqw}.slide-signature{opacity:.65}.slide-page.slide-theme-midnight{--slide-bg:#22334b;--slide-accent:#b5d1f7;--slide-soft:#2c4261;--slide-line:#4d607a}

```


## Measured reference checkpoints — final visual calibration

At a 1280×720 CSS-pixel viewport, header is y=0,h=48,padding=0 14px. The empty-state slide is x=145.78125,y=60,w=988.4375,h=555.9921875. It is contained 16:9 and centered in the area above the filmstrip, not stretched. The empty group is centered in both axes; heading “Start with an idea” is 28.16px/33.792,weight600; body is “Speak naturally. Your slides take shape as you talk.” at14px/22.4, wrapping to two lines in about310px width. The CTA is42px tall and about169.6px wide,13px/17.55 weight500. Empty surface #252b35, heading #e8edf5,body #b5c0d0,CTA #dce8ff/#243850.

With a slide and sidebar closed at1280×720: stage x=0,y=48,w=1280,h=580, padding0 14px 12px; drawing launcher x=18,y=310,w=52,h=56; canvas-fit region x=72,y=60,w=1194,h=556 contains the centered16:9 slide. Filmstrip y=628,h=92,padding5px16px;background#20242b. A thumbnail is116×65.25px atx=16,y=641.875. With sidebar open, the stage loses the sidebar width and the same contain rule applies. Do not enlarge the slide's aspect ratio to fill the width. The actual slide renderer padding/typography comes from the normative CSS appendix.


### Clean-room comparison corrections — component anatomy

These are exact styling requirements, not optional polish. At1280×720 withsidebar300px: the slide is x72,y86.56,w894,h502.875. Headerprojecttitle beginsx60; actions start approximatelyx700. Talk to generate is primary (microphone icon + label). Practice is a borderless ghost with Timer icon + label. Present is a borderless ghost with Presentation icon + label. Put a vertical divider between Present and the utility icon group. Utilities are Palette, Monitor, SlidersHorizontal, Download, PanelRight in that order; the sidebar button has selected filled background when open and a panel glyph with the rightpane filled, not a solid square. Do not use a Settings gear here. Toolbaricons are18px; labels12px.

Sidebar tabs occupy the entire width equally. The tabrow is56px high with8pxpadding. Selected Transcript tab is a34pxhigh rounded5px darkraised rectangle (#20262f), not an underline-only tab. Idle transcript copy is exactly “Your words appear here.”,centered with40pxtoppadding,12pxsecondary text. Context maintains the same selected-tab treatment.

Collapsed drawing launcher is52×56px with a thin #465060 outline,12pxradius,darksurface, penicon above a10px “Draw”label. Expanded tools use a vertical palette; draghandle,Pen,Highlighter,Eraser; corner dropdowns separate activation from options.

A slide's visible footer is part of the renderer: a short accent line bottomleft and “Made with Talkdeck” bottomright. Use the normative renderer footerlayout (small mutedletterspacedtext), not only a decorative line. Thumbnail number is zero-padded01,02,… placed inside the bottomleft corner; selectednumber background is paleaccent withdarktext. No externaltitle or tickmark. Addslide tile is100pxwide and76pxhigh, dashedborder,icon+text in one horizontalrow,alignedcenter in the92pxfilmstrip. Thumbnail remains116×65.25. Do not add an always-visible overflowbutton on every thumbnail: context menu appears on rightclick/ShiftF10.

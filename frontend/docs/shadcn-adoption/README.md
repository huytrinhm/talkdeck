# Official shadcn source adoption

The initial UI at commit `1e88ddf` used custom Radix wrappers with shadcn-style patterns. That did **not** establish actual shadcn source adoption. Keep this historical compliance gap visible; resemblance is not evidence.

This local iteration adopts eight component files from the official `shadcn-ui/ui` registry, pinned to commit `b8d7baa15b1dca5716f13153e63795fc3d741f6b`: Button, Input, Textarea, Dialog, Dropdown Menu, Tabs, Popover and Context Menu. The official MIT license is retained. `upstream/*.tsx.txt` preserves reviewable source snapshots; `provenance.json` lists pinned URLs, snapshot hashes and adopted-file hashes.

Adaptations preserve the approved Talkdeck appearance: use existing separate Radix modules, point `cn` to `src/lib/utils.ts`, and replace the registry’s default visual utility classes with existing Talkdeck CSS. The official component structure, props, data-slot markers, primitive/portal composition and export surface remain. Button retains the official CVA/Slot composition with local primary/danger aliases. The small app-facing Modal/Menu/Popover compositions now use the adopted component files; they are not the evidence of adoption by themselves.

`python3 docs/shadcn-adoption/adapt.py` reproduces those source adaptations without a browser. Do not run it blindly after making intentional component changes; record/update adaptations first. The generator is documentation tooling, excluded from runtime.

Source adoption is now reviewable. TypeScript/build pass. Exact visual/focus/interaction parity needs independent browser recheck before calling the whole requirement verified. Do not equate adoption with general production certification.

## Current stock-style iteration (2026-10-31)

The user explicitly requested stock shadcn styling across the entire app. The eight adopted primitives now retain the pinned upstream visual utility classes. The old Talkdeck visual-class replacement is superseded. Only local imports, compatibility aliases and nonvisual layout hooks remain; the app-facing compositions retain focus restoration and viewport containment.

`src/styles/theme.css` supplies the official neutral dark theme tokens and exposes them to Tailwind v4. Application chrome consumes these tokens; custom primitive paint overrides were removed. Slide document themes, annotation ink colors and meaningful success/error/diff colors remain domain data. The old folder model and every active folder route, picker, CRUD action and CSS selector have been removed; saved v2 projects upgrade to the flat v3 model through validated field selection.

`adapt.py` now regenerates stock-style adoption from the immutable upstream snapshots. Run it with the repository-supported Node version on PATH. Current adopted hashes are in provenance.json; final test receipts are under docs/superpowers/flat-shadcn-*.

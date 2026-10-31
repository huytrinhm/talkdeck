"""Reproduce import-only adoption with stock upstream visual utilities."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[2]
mods={'dialog':'Dialog','dropdown-menu':'DropdownMenu','tabs':'Tabs','popover':'Popover','context-menu':'ContextMenu'}
for name in ['button','input','textarea',*mods]:
    text=(root/'docs/shadcn-adoption/upstream'/f'{name}.tsx.txt').read_text()
    text=text.replace('import { cn } from "cn"','import { cn } from "../../lib/utils"').replace('import { Slot } from "radix-ui"','import * as Slot from "@radix-ui/react-slot"').replace('import { Button } from "@/registry/new-york-v4/ui/button"','import { Button } from "./button"')
    if name in mods:
        mod=mods[name]
        text=text.replace(f'import {{ {mod} as {mod}Primitive }} from "radix-ui"',f'import * as {mod}Primitive from "@radix-ui/react-{name}"')
    if name=='button':
        text=text.replace('  "inline-flex shrink-0','  "button inline-flex shrink-0',1)
        text=text.replace('        default: "bg-primary text-primary-foreground hover:bg-primary/90",','        primary: "bg-primary text-primary-foreground hover:bg-primary/90",\n        danger: "bg-destructive text-white hover:bg-destructive/90",\n        default: "bg-primary text-primary-foreground hover:bg-primary/90",')
    markers={'input':('h-9 w-full','input h-9 w-full'),'textarea':('border-input','input textarea border-input'),'dialog':('fixed top-[50%]','dialog-content fixed top-[50%]')}
    if name in markers:text=text.replace(*markers[name],1)
    text='// Stock shadcn/ui styles, pinned upstream source: docs/shadcn-adoption/.\n'+text
    (root/'src/components/ui'/f'{name}.tsx').write_text(text)
subprocess.run(['node',str(root/'node_modules/prettier/bin/prettier.cjs'),'--write',*[str(root/'src/components/ui'/f'{name}.tsx') for name in ['button','input','textarea',*mods]]],check=True)

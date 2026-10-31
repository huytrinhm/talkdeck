// Adapted from official shadcn/ui registry b8d7baa15b1dca5716f13153e63795fc3d741f6b.
// MIT license, upstream source and adaptations: docs/shadcn-adoption/.
import * as React from "react"
import { cn } from "../../lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("input textarea", className
      )}
      {...props}
    />
  )
}

export { Textarea }

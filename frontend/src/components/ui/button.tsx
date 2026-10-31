// Adapted from official shadcn/ui registry b8d7baa15b1dca5716f13153e63795fc3d741f6b.
// MIT license, upstream source and adaptations: docs/shadcn-adoption/.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"
import * as Slot from "@radix-ui/react-slot"

const buttonVariants = cva("button", {variants:{variant:{default:"button-default",primary:"button-primary",danger:"button-danger",destructive:"button-danger",outline:"button-default",secondary:"button-default",ghost:"button-ghost",link:"button-ghost"},size:{default:"",xs:"",sm:"",lg:"",icon:"button-icon","icon-xs":"button-icon","icon-sm":"button-icon","icon-lg":"button-icon"}},defaultVariants:{variant:"default",size:"default"}})

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

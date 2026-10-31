/** Talkdeck compositions over source-adopted shadcn primitives. */
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./dropdown-menu";
import {
  Popover as PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from "./popover";
export { Button } from "./button";
export { Input } from "./input";
export { Textarea } from "./textarea";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
export { cn } from "../../lib/utils";
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const opener = useRef<HTMLElement | null>(null),
    recent = useRef<HTMLElement[]>([]);
  useEffect(() => {
    if (open) return;
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target !== document.body &&
        !target.closest('[role="dialog"]')
      )
        recent.current = [
          target,
          ...recent.current.filter((el) => el !== target),
        ].slice(0, 5);
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={className}
        aria-describedby={description ? "dialog-description" : undefined}
        onOpenAutoFocus={() => {
          const target = document.activeElement;
          opener.current =
            target instanceof HTMLElement && target !== document.body
              ? target
              : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = [opener.current, ...recent.current].find(
            (el) => el?.isConnected && !el.closest('[role="dialog"]'),
          );
          if (target) {
            event.preventDefault();
            target.focus({ preventScroll: true });
          }
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        {description && (
          <DialogDescription id="dialog-description">
            {description}
          </DialogDescription>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Menu({
  trigger,
  children,
}: {
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="menu" sideOffset={6} collisionPadding={8}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function MenuItem({
  children,
  onSelect,
  disabled,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenuItem
      className={["menu-item", className].filter(Boolean).join(" ")}
      disabled={disabled}
      onSelect={onSelect}
    >
      {children}
    </DropdownMenuItem>
  );
}
export const MenuSeparator = () => (
  <DropdownMenuSeparator className="menu-separator" />
);
export function Popover({
  trigger,
  children,
  anchor,
  contentClassName,
  sideOffset = 8,
  side = "bottom",
  align = "center",
}: {
  trigger: ReactNode;
  children: ReactNode;
  anchor?: ReactNode;
  contentClassName?: string;
  sideOffset?: number;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {anchor && <PopoverAnchor asChild>{anchor}</PopoverAnchor>}
      <PopoverContent
        className={["popover", contentClassName].filter(Boolean).join(" ")}
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
      >
        {children}
      </PopoverContent>
    </PopoverRoot>
  );
}

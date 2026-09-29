import * as React from "react"
import { cn } from "@/lib/utils"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost"

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn("badge", className)}
      {...props}
    />
  )
}

export { Badge }

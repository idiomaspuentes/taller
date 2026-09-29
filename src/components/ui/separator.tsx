import * as React from "react"
import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<"div"> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-slot="separator"
      data-orientation={orientation}
      className={cn("separator", className)}
      {...props}
    />
  )
}

export { Separator }

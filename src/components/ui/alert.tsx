import * as React from "react"
import { cn } from "@/lib/utils"

function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "destructive" }) {
  return (
    <div data-slot="alert" data-variant={variant} role="alert" className={cn("alert", className)} {...props} />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("alert-title", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("alert-description", className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }

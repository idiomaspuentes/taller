import * as React from "react"
import { cn } from "@/lib/utils"

function Checkbox({
  className,
  checked,
  indeterminate,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "checked" | "onChange"> & {
  checked?: boolean
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      data-slot="checkbox"
      className={cn("checkbox", className)}
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  )
}

export { Checkbox }

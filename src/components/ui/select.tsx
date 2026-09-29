import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Native <select>, wearing the same compound-component API (Select /
 * SelectTrigger / SelectValue / SelectContent / SelectItem) the rest of the
 * app already calls it with. SelectContent/SelectItem never render on their
 * own — <Select> walks its children to build the real <select>'s <option>s,
 * since a native select's options must be its own direct children.
 *
 * SelectValue's custom children are intentionally ignored: in every call
 * site in this app they just restate the matching SelectItem's own label,
 * which the browser already shows for the selected option by default.
 */

type SelectItemProps = React.ComponentProps<"option"> & { value: string }

function Select({
  value,
  onValueChange,
  disabled,
  children,
}: {
  value?: string
  onValueChange: (value: string) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  const childArray = React.Children.toArray(children) as React.ReactElement[]
  const trigger = childArray.find((c) => c.type === SelectTrigger) as
    | React.ReactElement<SelectTriggerOwnProps>
    | undefined
  const content = childArray.find((c) => c.type === SelectContent) as
    | React.ReactElement<{ children?: React.ReactNode }>
    | undefined

  const options: React.ReactElement<SelectItemProps>[] = []
  if (content) {
    React.Children.forEach(content.props.children, (item) => {
      if (React.isValidElement(item) && item.type === SelectItem) {
        options.push(item as React.ReactElement<SelectItemProps>)
      }
    })
  }

  const triggerProps = trigger?.props

  return (
    <select
      data-slot="select"
      data-size={triggerProps?.size ?? "default"}
      aria-label={triggerProps?.["aria-label"]}
      id={triggerProps?.id}
      className={cn("select", triggerProps?.className)}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((item) => (
        <option key={item.props.value} value={item.props.value} disabled={item.props.disabled}>
          {item.props.children}
        </option>
      ))}
    </select>
  )
}

type SelectTriggerOwnProps = {
  className?: string
  size?: "sm" | "default"
  "aria-label"?: string
  id?: string
}

/** Marker only — <Select> reads these props, this never renders. */
function SelectTrigger(_props: SelectTriggerOwnProps & { children?: React.ReactNode }) {
  return null
}

/** Marker only — <Select> reads its children, this never renders. */
function SelectValue(_props: { placeholder?: string; children?: React.ReactNode }) {
  return null
}

/** Marker only — <Select> reads its children, this never renders. */
function SelectContent(_props: { position?: string; align?: string; className?: string; children?: React.ReactNode }) {
  return null
}

function SelectItem({ children }: SelectItemProps) {
  return <>{children}</>
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }

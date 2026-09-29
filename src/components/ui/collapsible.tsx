import * as React from "react"

type CollapsibleContextValue = { open: boolean; toggle: () => void }
const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null)

function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
  ...props
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  className?: string
} & Omit<React.ComponentProps<"div">, "children" | "className">) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const toggle = React.useCallback(() => {
    const next = !open
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }, [open, isControlled, onOpenChange])

  return (
    <CollapsibleContext.Provider value={{ open, toggle }}>
      <div data-slot="collapsible" data-state={open ? "open" : "closed"} className={className} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  )
}

function useCollapsible() {
  const ctx = React.useContext(CollapsibleContext)
  if (!ctx) throw new Error("CollapsibleTrigger/Content must be used inside <Collapsible>")
  return ctx
}

function CollapsibleTrigger({
  children,
  className,
  onClick,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const { open, toggle } = useCollapsible()

  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<{
      onClick?: React.MouseEventHandler
      "aria-expanded"?: boolean
      "data-slot"?: string
    }>
    return React.cloneElement(child, {
      "data-slot": "collapsible-trigger",
      "aria-expanded": open,
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event)
        toggle()
      },
    })
  }

  return (
    <button
      type="button"
      data-slot="collapsible-trigger"
      aria-expanded={open}
      className={className}
      onClick={(event) => {
        onClick?.(event)
        toggle()
      }}
      {...props}
    >
      {children}
    </button>
  )
}

function CollapsibleContent({ children, className }: { children?: React.ReactNode; className?: string }) {
  const { open } = useCollapsible()
  if (!open) return null
  return (
    <div data-slot="collapsible-content" className={className}>
      {children}
    </div>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }

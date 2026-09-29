import * as React from "react"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"

/**
 * Native <dialog> (showModal()), which handles its own top-layer rendering
 * and backdrop — no portal needed regardless of where it sits in the tree.
 */

type DialogContextValue = { open: boolean; onOpenChange: (open: boolean) => void }
const DialogContext = React.createContext<DialogContextValue | null>(null)

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return <DialogContext.Provider value={{ open, onOpenChange }}>{children}</DialogContext.Provider>
}

function useDialog() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error("DialogContent must be used inside <Dialog>")
  return ctx
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"dialog"> & { showCloseButton?: boolean }) {
  const { open, onOpenChange } = useDialog()
  const ref = React.useRef<HTMLDialogElement>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      data-slot="dialog-content"
      className={cn("dialog", className)}
      onClick={(event) => {
        if (event.target === ref.current) onOpenChange(false)
      }}
      onClose={() => onOpenChange(false)}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <button
          type="button"
          className="btn dialog-close"
          data-variant="ghost"
          data-size="icon-sm"
          onClick={() => onOpenChange(false)}
        >
          <XIcon />
          <span className="sr-only">Cerrar</span>
        </button>
      ) : null}
    </dialog>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("dialog-header", className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("dialog-footer", className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="dialog-title" className={cn("dialog-title", className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="dialog-description" className={cn("dialog-description", className)} {...props} />
}

export { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }

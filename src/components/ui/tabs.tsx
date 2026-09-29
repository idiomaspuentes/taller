import * as React from "react"
import { cn } from "@/lib/utils"

type TabsContextValue = { value: string; setValue: (value: string) => void }
const TabsContext = React.createContext<TabsContextValue | null>(null)

function Tabs({
  value,
  onValueChange,
  className,
  children,
  ...props
}: {
  value: string
  onValueChange: (value: string) => void
  className?: string
  children?: React.ReactNode
} & Omit<React.ComponentProps<"div">, "children" | "className" | "onChange">) {
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange }}>
      <div data-slot="tabs" className={cn("tabs", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

function useTabs() {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error("TabsTrigger/Content must be used inside <Tabs>")
  return ctx
}

function TabsList({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="tabs-list" role="tablist" className={cn("tabs-list", className)} {...props} />
}

function TabsTrigger({
  value,
  className,
  ...props
}: React.ComponentProps<"button"> & { value: string }) {
  const { value: active, setValue } = useTabs()
  const isActive = active === value
  return (
    <button
      type="button"
      role="tab"
      data-slot="tabs-trigger"
      data-active={isActive}
      aria-selected={isActive}
      className={cn("tabs-trigger", className)}
      onClick={() => setValue(value)}
      {...props}
    />
  )
}

function TabsContent({
  value,
  className,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const { value: active } = useTabs()
  if (active !== value) return null
  return <div data-slot="tabs-content" className={cn("tabs-content", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent }

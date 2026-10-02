import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useT, type MessageKey } from "../i18n/messages";

/**
 * Screens inside a project. The URL keeps one id per screen. Four are what a project is looked at through every day
 * (how it is going, its process, its subtareas, its published versions); the rest are tools for whoever needs to go
 * further (the reading of the book, handing work to people by name, writing the subtareas again) and sit under «Más».
 */
export type StepId = "avance" | "tareas" | "subtareas" | "publicar" | "inventario" | "asignar" | "entregar";

const MAIN: { id: StepId; label: MessageKey }[] = [
  { id: "avance", label: "pn.progress" },
  { id: "tareas", label: "pn.process" },
  { id: "subtareas", label: "pn.work" },
  { id: "publicar", label: "pn.version" },
];

const MORE: { id: StepId; label: MessageKey; hint: MessageKey }[] = [
  { id: "inventario", label: "pn.book", hint: "pn.bookHint" },
  { id: "asignar", label: "st.assign", hint: "pn.assignHint" },
  { id: "entregar", label: "pn.sync", hint: "pn.syncHint" },
];

/** A screen that needs the book to have been read is closed until it has. */
export function stepEnabled(id: StepId, setupDone: boolean, hasInventory: boolean): boolean {
  if (!setupDone) return false;
  if (id === "inventario" || id === "tareas") return true;
  return hasInventory;
}

type Props = {
  view: StepId;
  setupDone: boolean;
  hasInventory: boolean;
  onChange: (id: StepId) => void;
};

/** The screens of a project as tabs, with the less usual ones under «Más». */
export function StepNav({ view, setupDone, hasInventory, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const inMore = MORE.some((row) => row.id === view);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <nav aria-label={t("pn.aria")} className="pn">
      <div className="pn__tabs" role="tablist">
        {MAIN.map((row) => (
          <button key={row.id} type="button" role="tab" className="pn__tab" aria-selected={row.id === view} disabled={!stepEnabled(row.id, setupDone, hasInventory)} onClick={() => onChange(row.id)}>
            {t(row.label)}
          </button>
        ))}
      </div>
      <div className="pn__more" ref={menu}>
        <button type="button" className="pn__tab" aria-haspopup="menu" aria-expanded={open} data-on={inMore ? "true" : undefined} onClick={() => setOpen(!open)}>
          {inMore ? t(MORE.find((row) => row.id === view)!.label) : t("pn.more")} <ChevronDown size={14} aria-hidden />
        </button>
        {open ? (
          <div className="pn__menu" role="menu">
            {MORE.map((row) => (
              <button
                key={row.id}
                type="button"
                role="menuitem"
                className="pn__item"
                aria-current={row.id === view ? "page" : undefined}
                disabled={!stepEnabled(row.id, setupDone, hasInventory)}
                onClick={() => {
                  setOpen(false);
                  onChange(row.id);
                }}
              >
                <span>{t(row.label)}</span>
                <small>{t(row.hint)}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

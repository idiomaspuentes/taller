import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { useT, type MessageKey } from "../i18n/messages";
import { TEXT_SIZES, type TextSize } from "../domain/textSize";
import { setTextSize, useTextSize } from "../textSize";
import { useIntroEntry } from "./introSlot";

const TEXT_SIZE_NAME: Record<TextSize, MessageKey> = { normal: "menu.textNormal", large: "menu.textLarge", larger: "menu.textLarger" };

/** One thing a tool can do besides its work: what it is, and one line that says what it is for. */
export type MoreItem = {
  id: string;
  label: string;
  /** What it does, in a few words: a menu of names alone made the team guess. */
  hint?: string;
  /** How many there are inside (the notes of the passage), said on the row. */
  count?: number;
  /** A place to go, in another tab: the work in hand stays as it is. */
  href?: string;
  onSelect?: () => void;
  /** A view that is on now (the chapter open over the tool): it is ticked, and choosing it again turns it off. */
  pressed?: boolean;
  disabled?: boolean;
};

/**
 * «⋯ Más»: what a tool can do besides its work, in one place, so that the header keeps the way back, the name and
 * the one thing to do. After translationCore 4's account menu: each row says what it does under its name, and the
 * details nobody needs every day (the task, the file) come last, in grey. The button says «Más» beside its dots: a
 * bare icon did not tell the team there was anything there.
 */
export function MoreMenu({ items, details }: { items: MoreItem[]; details?: ReactNode }) {
  const t = useT();
  const textSize = useTextSize();
  const intro = useIntroEntry();
  // The introduction of the passage, where the tool has one to give (see `introSlot.ts`).
  const all: MoreItem[] = intro && !items.some((item) => item.id === "intro") ? [...items, { id: "intro", label: t("af.paneIntro"), hint: t("mm.introHint"), onSelect: intro.open }] : items;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const row = (item: MoreItem) => (
    <>
      <span className="mm-row__label">
        {item.label}
        {item.count ? <span className="mm-row__count">{item.count}</span> : null}
        {item.pressed ? <Check className="mm-row__on" size={16} aria-hidden /> : null}
      </span>
      {item.hint ? <span className="mm-row__hint">{item.hint}</span> : null}
    </>
  );
  return (
    <div className="mm" ref={box}>
      <button type="button" className="mm-button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <MoreHorizontal size={20} aria-hidden />
        <span>{t("mm.more")}</span>
      </button>
      <div className="mm-panel" id={panelId} hidden={!open}>
        {all.map((item) =>
          item.href ? (
            <a key={item.id} className="mm-row" href={item.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              {row(item)}
            </a>
          ) : (
            <button
              key={item.id}
              type="button"
              className="mm-row"
              aria-pressed={item.pressed === undefined ? undefined : item.pressed}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect?.();
              }}
            >
              {row(item)}
            </button>
          ),
        )}
        {/* The size of the text, in every tool: it was only in the person's menu, which a tool does not show, and
            whoever found the text small had to leave the work to change it (16 October). It stays open, to see it. */}
        <div className="mm-row mm-sizes">
          <span className="mm-row__label">{t("menu.textSize")}</span>
          <span className="mm-sizes__options" role="group" aria-label={t("menu.textSize")}>
            {TEXT_SIZES.map((size) => (
              <button key={size} type="button" data-size={size} aria-pressed={size === textSize} aria-label={t(TEXT_SIZE_NAME[size])} title={t(TEXT_SIZE_NAME[size])} onClick={() => setTextSize(size)}>
                A
              </button>
            ))}
          </span>
        </div>
        {details ? <div className="mm-details">{details}</div> : null}
      </div>
    </div>
  );
}

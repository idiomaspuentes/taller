import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  filterLanguageOptions,
  languageDisplayName,
  mergeLanguageOptions,
  normalizeLangCode,
  type LanguageOption,
} from "../domain/languages";

const ITEM_HEIGHT = 36;
const OVERSCAN = 8;

type Props = {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  languages?: LanguageOption[];
};

export function LanguagePicker({ id, value, onChange, languages = [] }: Props) {
  const uid = useId();
  const listId = `${id || uid}-list`;
  const searchId = `${id || uid}-search`;
  const otherId = `${id || uid}-other`;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherDraft, setOtherDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(ITEM_HEIGHT * 6);

  const options = useMemo(
    () => mergeLanguageOptions(languages, value),
    [languages, value],
  );
  const filtered = useMemo(
    () => filterLanguageOptions(options, query),
    [options, query],
  );
  const selected = normalizeLangCode(value);
  const selectedKnown = options.some((row) => row.code === selected);
  const selectedLabel = selected
    ? languageDisplayName(selected, languages)
    : "Elige una lengua";

  const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const end = Math.min(filtered.length, Math.ceil((scrollTop + viewportH) / ITEM_HEIGHT) + OVERSCAN);
  const visible = filtered.slice(start, end);
  const hint = !options.length
    ? "Cargando lenguas…"
    : query.trim()
      ? `${filtered.length} de ${options.length} lenguas`
      : `${options.length} lenguas — escribe para filtrar`;

  useEffect(() => {
    if (selected && !selectedKnown) {
      setOtherOpen(true);
      setOtherDraft(selected);
    }
  }, [selected, selectedKnown]);

  useEffect(() => {
    if (!open) return;
    setHighlight(0);
    setScrollTop(0);
    const search = document.getElementById(searchId);
    search?.focus();
    function onDoc(ev: MouseEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, searchId]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) setViewportH(el.clientHeight || ITEM_HEIGHT * 6);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !open) return;
    const top = highlight * ITEM_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ITEM_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ITEM_HEIGHT - el.clientHeight;
    }
  }, [highlight, open]);

  function pick(code: string) {
    onChange(normalizeLangCode(code));
    setOpen(false);
    setQuery("");
    setOtherOpen(false);
  }

  function commitOther() {
    const code = normalizeLangCode(otherDraft);
    if (!code) return;
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  function onTriggerKey(ev: KeyboardEvent<HTMLButtonElement>) {
    if (ev.key === "ArrowDown" || ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      setOpen(true);
    }
  }

  function onSearchKey(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      setOpen(false);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setHighlight((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      const row = filtered[highlight];
      if (row) pick(row.code);
    }
  }

  function onListScroll(ev: UIEvent<HTMLDivElement>) {
    setScrollTop(ev.currentTarget.scrollTop);
  }

  return (
    <div className="lang-picker" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="lang-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Lengua"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
      >
        <span className="lang-picker__name">{selectedLabel}</span>
        {selected ? <span className="lang-picker__code">{selected}</span> : null}
      </button>

      {open ? (
        <div className="lang-picker__panel">
          <Label htmlFor={searchId} className="sr-only">
            Buscar lengua
          </Label>
          <Input
            id={searchId}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              setScrollTop(0);
              if (listRef.current) listRef.current.scrollTop = 0;
            }}
            onKeyDown={onSearchKey}
            placeholder="Buscar por nombre o código…"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="lang-picker__hint" data-lang-count={options.length} data-lang-shown={filtered.length}>
            {hint}
          </p>
          <div
            ref={listRef}
            id={listId}
            className="lang-picker__list"
            role="listbox"
            aria-label="Lenguas"
            onScroll={onListScroll}
          >
            {filtered.length ? (
              <div className="lang-picker__virtual" style={{ height: filtered.length * ITEM_HEIGHT }}>
                {visible.map((row, i) => {
                  const idx = start + i;
                  return (
                    <button
                      key={row.code}
                      type="button"
                      role="option"
                      aria-selected={row.code === selected}
                      className="lang-picker__option"
                      data-active={idx === highlight ? "true" : "false"}
                      style={{ top: idx * ITEM_HEIGHT, height: ITEM_HEIGHT }}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => pick(row.code)}
                    >
                      <span className="lang-picker__name">{row.name}</span>
                      <span className="lang-picker__code">{row.code}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="lang-picker__empty">Sin coincidencias</p>
            )}
          </div>
          <div className="lang-picker__other">
            <button
              type="button"
              className="lang-picker__other-toggle"
              aria-expanded={otherOpen}
              onClick={() => setOtherOpen((v) => !v)}
            >
              Otra…
            </button>
            {otherOpen ? (
              <div className="lang-picker__other-row">
                <Label htmlFor={otherId} className="sr-only">
                  Código de lengua
                </Label>
                <Input
                  id={otherId}
                  value={otherDraft}
                  onChange={(e) => setOtherDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitOther();
                    }
                  }}
                  placeholder="código, p. ej. quh"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn"
                  data-variant="outline"
                  data-size="sm"
                  disabled={!normalizeLangCode(otherDraft)}
                  onClick={commitOther}
                >
                  Usar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

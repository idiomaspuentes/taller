import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryDoc, Portion, StatusCounts } from "../domain/types";
import { REMAINING } from "../domain/types";
import { BOOKS, bookName, isBookProjectId } from "../domain/books";
import { BookExplorerDialog } from "./BookExplorerDialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  /** Active project id (may be thematic slug). */
  book: string;
  projectBooks: string[];
  inventariarBook: string;
  onInventariarBookChange: (book: string) => void;
  inventory: InventoryDoc | null;
  jobMessage: string;
  generating: boolean;
  remoteBooks?: string[];
  onBookChange: (book: string) => void;
  onGenerate: () => void;
  onLoadFile: (file: File) => void;
  onContinue: () => void;
};

type BookInvStatus = {
  code: string;
  portions: Portion[];
  portionCount: number;
  tpl: number;
  tps: number;
  notas: number;
  preguntas: number;
  ready: boolean;
};

function portionsForBook(inventory: InventoryDoc | null, code: string): Portion[] {
  if (!inventory) return [];
  const want = code.toUpperCase();
  const stamped = inventory.portions.filter(
    (p) => (p.book || "").toUpperCase() === want,
  );
  if (stamped.length) return stamped;
  if (
    inventory.portions.length &&
    (inventory.book || "").toUpperCase() === want &&
    !inventory.portions.some((p) => p.book)
  ) {
    return inventory.portions;
  }
  return [];
}

function statusForBook(inventory: InventoryDoc | null, code: string): BookInvStatus {
  const portions = portionsForBook(inventory, code);
  return {
    code,
    portions,
    portionCount: portions.length,
    tpl: portions.reduce((n, p) => n + (p.tpl || 0), 0),
    tps: portions.reduce((n, p) => n + (p.tps || 0), 0),
    notas: portions.reduce((n, p) => n + (p.notasItems.length || p.notas), 0),
    preguntas: portions.reduce((n, p) => n + (p.preguntasItems.length || p.preguntas), 0),
    ready: portions.length > 0,
  };
}

type ArticleKindStats = { total: number; done: number; pending: number };

function articleKindStats(
  articles: InventoryDoc["articles"],
  kind: "Translation Academy" | "Translation Words",
  counts?: Partial<StatusCounts>,
): ArticleKindStats {
  const list = articles.filter((a) => a.kind === kind);
  const total = counts?.articles ?? list.length;
  const done = counts?.translated ?? list.filter((a) => a.status === "translated").length;
  const pending = list.filter((a) => REMAINING.has(a.status)).length;
  return { total, done, pending };
}

function formatDoneTotal(stats: ArticleKindStats): string {
  if (!stats.total) return "0/0";
  return `${stats.done}/${stats.total}`;
}

export function BookStepView({
  book,
  projectBooks,
  inventariarBook,
  onInventariarBookChange,
  inventory,
  jobMessage,
  generating,
  onBookChange,
  onGenerate,
  onLoadFile,
  onContinue,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailPinnedClosed, setDetailPinnedClosed] = useState(false);
  const [maintainOpen, setMaintainOpen] = useState(false);

  const books = projectBooks.length ? projectBooks : isBookProjectId(book) ? [book] : [];
  const multi = books.length > 1;
  const activeBook = inventariarBook || books[0] || book;

  const bookStatuses = useMemo(
    () => books.map((code) => statusForBook(inventory, code)),
    [books, inventory],
  );
  const missingBooks = bookStatuses.filter((s) => !s.ready);
  const readyBooks = bookStatuses.filter((s) => s.ready);
  const activeStatus = statusForBook(inventory, activeBook);
  const selectedBook = BOOKS.find((b) => b.code === activeBook);
  const ready = multi ? missingBooks.length === 0 && books.length > 0 : activeStatus.ready;
  const articleList = inventory?.articles ?? [];
  const pending = articleList.filter((a) => REMAINING.has(a.status)).length;
  const academia = articleKindStats(
    articleList,
    "Translation Academy",
    inventory?.counts?.academia,
  );
  const palabras = articleKindStats(
    articleList,
    "Translation Words",
    inventory?.counts?.palabras,
  );
  const nextMissing = missingBooks[0]?.code;

  useEffect(() => {
    if (!multi || !books.length) return;
    if (!books.includes(activeBook)) {
      onInventariarBookChange(missingBooks[0]?.code || books[0]);
    }
  }, [multi, books, activeBook, missingBooks, onInventariarBookChange]);

  useEffect(() => {
    setDetailPinnedClosed(false);
  }, [activeBook, inventory?.generated_at]);

  useEffect(() => {
    if (!activeStatus.ready) return;
    if (pending > 0 && !detailPinnedClosed) setDetailOpen(true);
    if (pending === 0) setDetailOpen(false);
  }, [activeStatus.ready, pending, detailPinnedClosed, activeBook]);

  const explorerInventory: InventoryDoc | null =
    inventory && activeStatus.ready
      ? {
          ...inventory,
          book: activeBook,
          portions: activeStatus.portions,
        }
      : null;

  function selectBook(code: string) {
    onInventariarBookChange(code);
    if (!multi) onBookChange(code);
  }

  function toggleDetail() {
    setDetailOpen((open) => {
      const next = !open;
      setDetailPinnedClosed(!next);
      return next;
    });
  }

  return (
    <div className="hub">
      <div className="hub-header">
        <div>
          <h1 className="hub-title">
            {activeBook} — {bookName(activeBook) || activeBook}
          </h1>
          <p className="hub-lede">
            {multi
              ? activeStatus.ready
                ? `${activeBook} listo · ${activeStatus.portionCount} porciones`
                : `${activeBook} sin inventario`
              : activeStatus.ready
                ? `Inventario listo · ${activeStatus.portionCount} porciones`
                : "Genera o carga el inventario de este libro."}
          </p>
        </div>
        {multi ? (
          <div className="grid gap-1 min-w-[11rem]">
            <label htmlFor="inv-book" className="text-xs font-medium text-muted-foreground">
              Libro
            </label>
            <Select value={activeBook} onValueChange={selectBook}>
              <SelectTrigger id="inv-book" className="w-full" aria-label="Libro a inventariar">
                <SelectValue>
                  {selectedBook
                    ? `${selectedBook.code}${activeStatus.ready ? "" : " · pendiente"}`
                    : activeBook}
                </SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {bookStatuses.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.code} — {bookName(s.code)}
                    {s.ready ? ` · ${s.portionCount}` : " · pendiente"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {!activeStatus.ready ? (
        <div className="hub-empty-panel">
          <span className="hub-empty-panel__kicker">Pendiente</span>
          <h2 className="hub-empty-panel__title">Sin inventario para {activeBook}</h2>
          <p className="hub-empty-panel__body">
            Genera desde DCS o carga un JSON. Eso es lo único necesario para este libro.
          </p>
          <div className="hub-empty-panel__actions">
            <Button type="button" onClick={onGenerate} disabled={generating || !activeBook}>
              {generating ? "Generando…" : `Inventariar ${activeBook}`}
            </Button>
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              Cargar JSON
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="hub-panel">
            {multi ? (
              <p className="text-sm font-medium text-foreground">
                {readyBooks.length} de {books.length} libros listos
                {nextMissing ? (
                  <>
                    {" · siguiente: "}
                    <button
                      type="button"
                      className="underline-offset-2 hover:underline"
                      onClick={() => selectBook(nextMissing)}
                    >
                      {nextMissing}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {pending > 0 ? (
              <p className="inv-metrics__alert">
                {pending} artículos pendientes de traducción en las ayudas
              </p>
            ) : (
              <p className="inv-metrics__ok">Listo para definir fases y tareas</p>
            )}
          </div>

          <div className="inv-detail">
            <div className="inv-detail__bar">
              <button
                type="button"
                className="inv-disclosure__toggle"
                aria-expanded={detailOpen}
                onClick={toggleDetail}
              >
                <span className="inv-disclosure__chevron" data-open={detailOpen ? "true" : "false"} aria-hidden>
                  ▾
                </span>
                Detalle
              </button>
              {detailOpen ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setExplorerOpen(true)}
                >
                  Explorar
                </Button>
              ) : null}
            </div>
            {detailOpen ? (
              <div className="inv-detail__body" aria-label="Detalle del inventario">
                <dl className="inv-detail__table">
                  <div className="inv-detail__row">
                    <dt>Escritura</dt>
                    <dd>
                      TPL {activeStatus.tpl}
                      <span className="inv-detail__sep" aria-hidden>
                        ·
                      </span>
                      TPS {activeStatus.tps}
                    </dd>
                  </div>
                  <div className="inv-detail__row">
                    <dt>Ayudas</dt>
                    <dd>
                      {activeStatus.notas} notas
                      <span className="inv-detail__sep" aria-hidden>
                        ·
                      </span>
                      {activeStatus.preguntas} preguntas
                    </dd>
                  </div>
                  <div className="inv-detail__row">
                    <dt>Artículos</dt>
                    <dd>
                      <span title={`${academia.done} traducidos · ${academia.pending} pendientes`}>
                        Academia {formatDoneTotal(academia)}
                      </span>
                      <span className="inv-detail__sep" aria-hidden>
                        ·
                      </span>
                      <span title={`${palabras.done} traducidos · ${palabras.pending} pendientes`}>
                        Palabras {formatDoneTotal(palabras)}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </div>

          <div className="inv-maintain">
            <button
              type="button"
              className="inv-disclosure__toggle"
              aria-expanded={maintainOpen}
              onClick={() => setMaintainOpen((v) => !v)}
            >
              <span
                className="inv-disclosure__chevron"
                data-open={maintainOpen ? "true" : "false"}
                aria-hidden
              >
                ▾
              </span>
              Regenerar o reemplazar
            </button>
            {maintainOpen ? (
              <div className="inv-maintain__body flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={onGenerate}
                  disabled={generating}
                >
                  {generating ? "Generando…" : `Regenerar ${activeBook}`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  Cargar JSON
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onLoadFile(file);
          e.target.value = "";
        }}
      />

      {jobMessage ? <p className="hub-hint">{jobMessage}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setHelpOpen((v) => !v)}
        >
          {helpOpen ? "Ocultar ayuda" : "¿Cómo funciona?"}
        </button>
        <Button
          type="button"
          variant={ready ? "default" : "ghost"}
          disabled={!ready}
          onClick={onContinue}
        >
          Continuar a fases y tareas
        </Button>
      </div>
      {helpOpen ? (
        <p className="hub-hint">
          {multi
            ? "Cada libro se inventaría y se guarda en su propia ruta DCS. Completa todos antes de pasar a fases y tareas. "
            : "El tablero de asignación usa este inventario. Regenerar reemplaza porciones y artículos desde las fuentes. "}
          {pending > 0
            ? "Puedes continuar aunque queden ayudas en inglés; el inventario de porciones ya sirve para asignar."
            : null}
        </p>
      ) : null}

      {explorerInventory ? (
        <BookExplorerDialog
          open={explorerOpen}
          onClose={() => setExplorerOpen(false)}
          inventory={explorerInventory}
          focusPending={pending > 0}
        />
      ) : null}
    </div>
  );
}

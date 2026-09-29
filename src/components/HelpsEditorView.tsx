import { useCallback, useEffect, useMemo, useState } from "react";
import { getContents, getRawContent } from "@ip-lms/dcs-client";
import { loadSession, type GtSession } from "../dcs/auth";
import { dcsConfig } from "../dcs/config";
import { loadPmConfig } from "../dcs/issues";
import {
  ensurePortionPr,
  getPmIssue,
  resolveVisiblePortionPr,
  saveTextOnPortionBranch,
} from "../dcs/portionPr";
import { recordOwnSave } from "../domain/pendingEvents";
import { loadAssignmentsFromDcs, loadInventoryFromDcs } from "../dcs/persist";
import {
  applyHelpsTsvEdits,
  articleRefsToDraftItems,
  collectHelpsArticleRefs,
  selectTsvRowsForPortion,
  tsvFieldsForItem,
  tsvRowsToDraftItems,
  type HelpsDraftItem,
} from "../domain/helpsDraft";
import { loadHelpsDraftCache, saveHelpsDraftCache } from "../domain/helpsDraftCache";
import { resolveHelpsTarget, type HelpsTarget } from "../domain/helpsTarget";
import { portionPrBranchFromCtx } from "../domain/portionPr";
import {
  decodeSolverLaunchContext,
  type SolverLaunchContext,
} from "../domain/solverLaunch";
import {
  isLabLaunch,
  labPlaceholderHelpsItems,
  labWriteDecision,
  launchDraftSlot,
} from "../domain/solverLab";
import type { InventoryDoc } from "../domain/types";
import { parseTsvTable } from "../prep/tsv";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Props = {
  ctxEncoded: string;
  onClose: () => void;
  announce: (msg: string) => void;
};

type FileMeta = { text: string; sha?: string };

async function readFileOnRef(
  session: GtSession,
  owner: string,
  repo: string,
  filepath: string,
  ref?: string,
): Promise<FileMeta> {
  const config = dcsConfig(session.host);
  const meta = await getContents(config, owner, repo, filepath, {
    token: session.token,
    ref,
  });
  if (Array.isArray(meta)) {
    throw new Error(`«${filepath}» es un directorio, no un archivo.`);
  }
  const text = await getRawContent(config, owner, repo, filepath, {
    token: session.token,
    ref,
  });
  return { text, sha: ref ? meta.sha : undefined };
}

async function readFilePreferBranch(
  session: GtSession,
  owner: string,
  repo: string,
  filepath: string,
  branch: string,
): Promise<FileMeta> {
  try {
    return await readFileOnRef(session, owner, repo, filepath, branch);
  } catch {
    return readFileOnRef(session, owner, repo, filepath);
  }
}

export function HelpsEditorView({ ctxEncoded, onClose, announce }: Props) {
  const [session, setSession] = useState<GtSession | undefined>(() => loadSession());
  const [ctx, setCtx] = useState<SolverLaunchContext | null>(null);
  const [target, setTarget] = useState<HelpsTarget | null>(null);
  const [items, setItems] = useState<HelpsDraftItem[]>([]);
  const [files, setFiles] = useState<Record<string, FileMeta>>({});
  const [branch, setBranch] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingPr, setOpeningPr] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const decoded = decodeSolverLaunchContext(ctxEncoded);
    if (!decoded) {
      setError("Contexto de lanzamiento inválido o incompleto.");
      return;
    }
    setCtx(decoded);
    const slot = launchDraftSlot(decoded);
    const cache = loadHelpsDraftCache(slot.pmOrg, slot.issueNumber);
    const lab = isLabLaunch(decoded);
    const fallbackBranch = portionPrBranchFromCtx(decoded);

    const sess = loadSession();
    setSession(sess);

    let inventory: InventoryDoc | null = null;
    let pmConfig = undefined;
    if (sess?.token) {
      try {
        pmConfig = await loadPmConfig(sess, decoded.pmOrg);
      } catch {
        pmConfig = undefined;
      }
      try {
        inventory = await loadInventoryFromDcs(
          sess,
          decoded.pmOrg,
          decoded.lang,
          decoded.book,
        );
      } catch {
        inventory = null;
      }
    }

    const resolved = resolveHelpsTarget(
      lab && !decoded.contentOrg.trim()
        ? { ...decoded, contentOrg: "local" }
        : decoded,
      pmConfig,
    );
    if ("error" in resolved) {
      setError(resolved.error);
      return;
    }
    setTarget(resolved);

    if (!sess?.token) {
      if (cache) {
        const restored: HelpsDraftItem[] = Object.entries(cache.texts).map(
          ([id, text]) => ({
            id,
            label: id,
            meta: resolved.kind === "tsv" ? "local" : id,
            text,
            secondary: cache.secondary?.[id],
            secondaryLabel: resolved.resource === "preguntas" ? "Respuesta" : undefined,
            filepath: resolved.filepath || id,
            kind: resolved.kind,
          }),
        );
        setItems(restored);
        setBranch(cache.branch || fallbackBranch);
        setDirty(true);
      } else if (lab) {
        setItems(labPlaceholderHelpsItems(decoded, resolved));
        setBranch(fallbackBranch);
      }
      setError(
        lab
          ? "Laboratorio sin sesión: el borrador queda en este navegador."
          : "Sin sesión: el borrador queda en este navegador. Conéctate para guardar en DCS.",
      );
      return;
    }

    setBusy(true);
    setError("");
    try {
      let head = cache?.branch || fallbackBranch;
      if (!lab && decoded.issueNumber > 0 && decoded.pmOrg) {
        try {
          const issue = await getPmIssue(sess, decoded.pmOrg, decoded.issueNumber);
          const visible = await resolveVisiblePortionPr({
            session: sess,
            pmOrg: decoded.pmOrg,
            issue,
            workBranch: fallbackBranch,
            username: decoded.username || sess.username,
            book: decoded.book || decoded.projectId,
            taskId: decoded.taskId,
          });
          if (visible.marker) {
            head = visible.marker.head;
            setPrUrl(visible.marker.htmlUrl);
          } else {
            setPrUrl("");
          }
        } catch {
          /* offline / missing issue */
        }
      }
      setBranch(head);

      if (resolved.kind === "tsv" && resolved.filepath) {
        try {
          const file = await readFilePreferBranch(
            sess,
            resolved.owner,
            resolved.repo,
            resolved.filepath,
            head,
          );
          setFiles({ [resolved.filepath]: file });
          const { rows } = parseTsvTable(file.text);
          const tsvResource = resolved.resource === "preguntas" ? "preguntas" : "notas";
          let next = tsvRowsToDraftItems(
            tsvResource,
            resolved.filepath,
            selectTsvRowsForPortion(rows, decoded, inventory),
          );
          let usedCache = false;
          if (cache) {
            next = next.map((item) => {
              const cached = cache.texts[item.id];
              const cachedSec = cache.secondary?.[item.id];
              if (cached != null && cached !== item.text) usedCache = true;
              if (cachedSec != null && cachedSec !== (item.secondary ?? "")) usedCache = true;
              return {
                ...item,
                text: cached ?? item.text,
                secondary: cachedSec ?? item.secondary,
              };
            });
          }
          if (!next.length && lab) next = labPlaceholderHelpsItems(decoded, resolved);
          setItems(next);
          setDirty(usedCache);
          if (usedCache) announce("Se restauró un borrador local (aún no está en DCS).");
          return;
        } catch (err) {
          if (lab) {
            setItems(labPlaceholderHelpsItems(decoded, resolved));
            setError("");
            return;
          }
          throw err;
        }
      }

      const refs = collectHelpsArticleRefs(decoded, inventory);
      const mdResource = resolved.resource === "academia" ? "academia" : "palabras";
      const drafts = articleRefsToDraftItems(mdResource, refs);
      const nextFiles: Record<string, FileMeta> = {};
      const nextItems: HelpsDraftItem[] = [];
      let usedCache = false;
      for (const item of drafts) {
        let remote = "";
        try {
          const file = await readFilePreferBranch(
            sess,
            resolved.owner,
            resolved.repo,
            item.filepath,
            head,
          );
          nextFiles[item.filepath] = file;
          remote = file.text;
        } catch {
          nextFiles[item.filepath] = { text: "" };
        }
        const cached = cache?.texts[item.id];
        if (cached != null && cached !== remote) usedCache = true;
        nextItems.push({ ...item, text: cached ?? remote });
      }
      setFiles(nextFiles);
      setItems(nextItems.length || !lab ? nextItems : labPlaceholderHelpsItems(decoded, resolved));
      setDirty(usedCache);
      if (usedCache) announce("Se restauró un borrador local (aún no está en DCS).");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [ctxEncoded, announce]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = useMemo(() => {
    if (!ctx) return "Ayudas";
    return `${ctx.book} ${ctx.ref} · ${(ctx.resource || "").toUpperCase()}`;
  }, [ctx]);

  function persistLocal(nextItems: HelpsDraftItem[], nextBranch: string) {
    if (!ctx) return;
    const texts: Record<string, string> = {};
    const secondary: Record<string, string> = {};
    for (const item of nextItems) {
      texts[item.id] = item.text;
      if (item.secondary != null) secondary[item.id] = item.secondary;
    }
    const slot = launchDraftSlot(ctx);
    saveHelpsDraftCache(slot.pmOrg, slot.issueNumber, {
      texts,
      secondary: Object.keys(secondary).length ? secondary : undefined,
      savedAt: Date.now(),
      branch: nextBranch,
    });
  }

  function updateItem(id: string, patch: Partial<Pick<HelpsDraftItem, "text" | "secondary">>) {
    setItems((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item));
      persistLocal(next, branch);
      return next;
    });
    setDirty(true);
  }

  async function save() {
    if (!ctx || !target) return;
    persistLocal(items, branch);
    if (!session) {
      announce("Borrador guardado en este navegador.");
      return;
    }
    if (isLabLaunch(ctx)) {
      const decision = labWriteDecision(ctx);
      if (decision.mode === "local") {
        announce(decision.reason);
        return;
      }
      if (decision.mode === "blocked") {
        setError(decision.reason);
        return;
      }
    }
    const head = branch || portionPrBranchFromCtx(ctx);
    const ownAction = { host: session.host, username: session.username, pmOrg: ctx.pmOrg };
    setSaving(true);
    setError("");
    try {
      const nextFiles = { ...files };
      if (target.kind === "tsv" && target.filepath) {
        const original = files[target.filepath]?.text ?? "";
        const resource = target.resource === "preguntas" ? "preguntas" : "notas";
        const content = applyHelpsTsvEdits(
          original,
          items.map((item) => ({
            id: item.id,
            fields: tsvFieldsForItem(resource, item),
          })),
        );
        const message = `TAS: ${target.book} ${ctx.ref} (${ctx.resource}) · #${ctx.issueNumber || "—"}`;
        const saved = await saveTextOnPortionBranch({
          session,
          owner: target.owner,
          repo: target.repo,
          filepath: target.filepath,
          content,
          message,
          branch: head,
          sha: files[target.filepath]?.sha,
          book: ctx.book,
          resource: ctx.resource,
          taskId: ctx.taskId,
          phaseSlug: ctx.phaseSlug,
          username: ctx.username || session.username,
          issueNumber: ctx.issueNumber,
        });
        recordOwnSave(ownAction, ctx.issueNumber, message, saved.commitSha);
        nextFiles[target.filepath] = { text: content, sha: saved.sha };
      } else {
        for (const item of items) {
          const remote = files[item.filepath]?.text ?? "";
          if (item.text === remote && files[item.filepath]?.sha) continue;
          const message = `TAS: ${item.label} (${ctx.resource}) · #${ctx.issueNumber || "—"}`;
          const saved = await saveTextOnPortionBranch({
            session,
            owner: target.owner,
            repo: target.repo,
            filepath: item.filepath,
            content: item.text,
            message,
            branch: head,
            sha: files[item.filepath]?.sha,
            book: ctx.book,
            resource: ctx.resource,
            taskId: ctx.taskId,
            phaseSlug: ctx.phaseSlug,
            username: ctx.username || session.username,
            issueNumber: ctx.issueNumber,
          });
          recordOwnSave(ownAction, ctx.issueNumber, message, saved.commitSha);
          nextFiles[item.filepath] = { text: item.text, sha: saved.sha };
        }
      }
      setFiles(nextFiles);
      setBranch(head);
      setDirty(false);
      persistLocal(items, head);
      announce(`Guardado en ${target.owner}/${target.repo} @ ${head}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function openPr() {
    if (!session || !ctx) return;
    setOpeningPr(true);
    setError("");
    try {
      if (dirty) await save();
      const issue = await getPmIssue(session, ctx.pmOrg, ctx.issueNumber);
      const board = await loadAssignmentsFromDcs(
        session,
        ctx.pmOrg,
        ctx.lang,
        ctx.projectId,
        ctx.contentOrg,
      );
      if (!board) {
        throw new Error("No se encontró el plan del proyecto para abrir la revisión.");
      }
      const result = await ensurePortionPr({
        session,
        pmOrg: ctx.pmOrg,
        lang: ctx.lang,
        contentOrg: ctx.contentOrg,
        board,
        issue,
      });
      setPrUrl(result.marker.htmlUrl);
      setBranch(result.marker.head);
      announce(
        result.created
          ? "Revisión abierta para esta subtarea"
          : "La revisión de esta subtarea ya estaba abierta",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningPr(false);
    }
  }

  return (
    <div className="scripture-editor">
      <header className="scripture-editor__head">
        <div className="min-w-0">
          <p className="scripture-editor__kicker">
            {ctx && isLabLaunch(ctx) ? "Ayudas · laboratorio" : "Ayudas · un borrador por subtarea"}
          </p>
          <h1 className="scripture-editor__title">{title}</h1>
          <p className="scripture-editor__meta">
            {ctx?.taskName ? `${ctx.taskName} · ` : ""}
            {target ? `${target.owner}/${target.repo}` : "…"}
            {target?.filepath ? `/${target.filepath}` : ""}
            {ctx?.issueNumber ? ` · #${ctx.issueNumber}` : ""}
          </p>
        </div>
        <div className="scripture-editor__actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          {ctx && isLabLaunch(ctx) ? null : prUrl ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open(prUrl, "_blank", "noopener,noreferrer")}
            >
              Abrir en Door43
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={busy || openingPr || !session || !ctx?.issueNumber}
              onClick={() => void openPr()}
            >
              {openingPr ? "Abriendo…" : "Listo para revisión"}
            </Button>
          )}
          <Button
            type="button"
            disabled={busy || saving || !items.length || (!dirty && Boolean(session))}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : session ? "Guardar borrador" : "Guardar local"}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p className="scripture-editor__loading">Cargando ayudas…</p>
      ) : (
        <div className="scripture-editor__body">
          {!session ? (
            <p className="text-sm text-muted-foreground">
              Puedes redactar sin red. Al iniciar sesión, Guardar sube tu borrador
              de esta subtarea (no el borrador principal). La revisión se abre con
              Listo para revisión.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Un recurso por lanzamiento. Lista de esta porción; el resto del
              archivo no se toca.
            </p>
          )}
          {items.map((item) => (
            <div key={item.id} className="scripture-editor__verse">
              <div className="scripture-editor__verse-head">
                <Label htmlFor={`help-${item.id}`}>{item.label}</Label>
                <p className="scripture-editor__source">{item.meta}</p>
              </div>
              <textarea
                id={`help-${item.id}`}
                className="scripture-editor__input"
                rows={item.kind === "markdown" ? 8 : 4}
                value={item.text}
                onChange={(e) => updateItem(item.id, { text: e.target.value })}
                placeholder="Texto…"
              />
              {item.secondaryLabel ? (
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">{item.secondaryLabel}</span>
                  <textarea
                    className="scripture-editor__input"
                    rows={3}
                    value={item.secondary ?? ""}
                    onChange={(e) => updateItem(item.id, { secondary: e.target.value })}
                    placeholder={item.secondaryLabel}
                  />
                </label>
              ) : null}
            </div>
          ))}
          {!items.length && !error ? (
            <p className="text-sm text-muted-foreground">
              No hay ítems de esta ayuda en la porción.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

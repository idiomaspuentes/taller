import { useRef, useState } from "react";
import type { AssignmentsDoc, InventoryDoc } from "../domain/types";
import { STATE_LABEL } from "../domain/types";
import {
  bundleEnabled,
  loadByPerson,
  loadByTeam,
  pipelineCounts,
  resolvedRuleGrain,
  scopeRuleLabel,
  teamRules,
} from "../domain/assignment";
import { normalizeAssignmentsDoc, toExportDoc } from "../domain/store";
import type { GtSession } from "../dcs/auth";
import { saveProjectToDcs } from "../dcs/persist";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  board: AssignmentsDoc;
  inventory: InventoryDoc | null;
  session: GtSession | null;
  pmOrg: string;
  onImported: (doc: AssignmentsDoc) => void;
  announce: (msg: string) => void;
};

export function PublishView({
  board,
  inventory,
  session,
  pmOrg,
  onImported,
  announce,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const counts = pipelineCounts(board.assignments);
  const byPerson = loadByPerson(board.assignments, board.people);
  const byTeam = loadByTeam(board.assignments, board.teams);
  const canSave = Boolean(session && pmOrg);

  function download() {
    const doc = toExportDoc(board);
    const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gateway-${board.lang}-${board.book}-asignaciones.json`;
    a.click();
    URL.revokeObjectURL(url);
    announce("JSON descargado.");
  }

  async function saveRemote() {
    if (!session) {
      setError("Inicia sesión para guardar en DCS.");
      return;
    }
    if (!pmOrg) {
      setError("Elige la organización PM en Contexto.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveProjectToDcs({
        session,
        org: pmOrg,
        lang: board.lang,
        book: board.book,
        assignments: board,
        inventory,
      });
      announce(`Guardado en ${pmOrg}/gateway-tasks/${board.lang}/${board.book}/`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function importFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        const normalized = normalizeAssignmentsDoc(parsed, {
          book: board.book,
          lang: board.lang,
          contentOrg: board.contentOrg,
          pmOrg: board.pmOrg || pmOrg,
        });
        onImported(normalized);
        announce("Asignaciones importadas.");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
  }

  return (
    <Card size="sm">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Publicar</CardTitle>
          <CardDescription>
            Entrega de {board.book} · {board.lang}
            {session && pmOrg ? ` · ${pmOrg}/gateway-tasks` : ""}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" onClick={download}>
            Descargar JSON
          </Button>
          <Button type="button" disabled={busy || !canSave} onClick={() => void saveRemote()}>
            {busy ? "Guardando…" : "Guardar en DCS"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
            Importar
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!canSave ? (
          <p className="text-sm text-muted-foreground">
            {session
              ? "Elige la organización PM en Contexto para guardar en DCS."
              : "Descarga el JSON ahora. Para guardar en DCS, inicia sesión en la barra."}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Stat value={board.assignments.length} label="Asignaciones" />
          {(Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]).map((state) => (
            <Stat key={state} value={counts[state]} label={STATE_LABEL[state]} />
          ))}
        </div>

        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Carga por persona
        </h3>
        <div className="grid gap-1.5">
          {byPerson.map(({ person, count }) => (
            <div key={person.id} className="flex items-center justify-between gap-3">
              <div>
                <strong className="font-medium">{person.name}</strong>
                <div className="text-xs text-muted-foreground">{count} ítems</div>
              </div>
              <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span
                  className="block h-full bg-primary"
                  style={{
                    width: `${Math.min(100, (count / Math.max(1, board.assignments.length)) * 100)}%`,
                  }}
                />
              </span>
            </div>
          ))}
          {!byPerson.length ? (
            <p className="text-sm text-muted-foreground">Todavía no hay asignaciones.</p>
          ) : null}
        </div>

        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Carga por equipo / fase
        </h3>
        <div className="grid gap-1.5">
          {byTeam.map(({ team, count }) => (
            <div key={team.id} className="rounded-lg border p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="font-medium">{team.name}</strong>
                  {team.description?.trim() ? (
                    <p className="text-sm text-muted-foreground">{team.description.trim()}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                    {bundleEnabled(team) ? <span>Asignar juntos</span> : null}
                    {teamRules(team).map((rule) => (
                      <span key={`${rule.resource}-${rule.articleFilter}`}>
                        {scopeRuleLabel(rule, resolvedRuleGrain(team, rule))}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="text-sm font-medium tabular-nums">{count} ítems</span>
              </div>
            </div>
          ))}
          {!byTeam.length ? (
            <p className="text-sm text-muted-foreground">
              Las fases duplicadas (p. ej. dos equipos de Academia) aparecen aquí por separado.
            </p>
          ) : null}
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2.5 py-2">
      <strong className="block text-xl font-semibold tracking-tight">{value}</strong>
      <span className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

import { useState } from "react";
import { DcsApiError } from "@ip-lms/dcs-client";
import type { GtSession } from "../dcs/auth";
import {
  inspectTestScenario,
  runTestScenario,
  type TestScenarioInspection,
  type TestScenarioResult,
} from "../dcs/qaScenario";
import { defaultOtherTester, testRunTag, testScenarioRunBlock } from "../domain/qaAdmin";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  session: GtSession;
  defaultPmOrg: string;
  owner: string;
  repo: string;
  book: string;
  onBusyChange: (busy: boolean) => void;
};

const RESOURCE_LABEL = "TPL";

function errorText(err: unknown): string {
  if (err instanceof DcsApiError) return `${err.message} (HTTP ${err.status})`;
  return err instanceof Error ? err.message : String(err);
}

function seen(value: boolean): string {
  return value ? "sí" : "no (404)";
}

function trunkActionText(inspection: TestScenarioInspection): string {
  const action = inspection.plan.trunk;
  if (!action) return "—";
  if (action.kind === "reuse") return `ya es rama real; se usa su punta ${action.sha.slice(0, 12)}`;
  if (action.kind === "create") return `POST /branches desde «${action.fromBranch}»`;
  return `ref fantasma: DELETE de esa ref y POST /branches desde ${action.sha.slice(0, 12)}`;
}

export function QaTestScenarioSection({ session, defaultPmOrg, owner, repo, book, onBusyChange }: Props) {
  const [pmOrg, setPmOrg] = useState(defaultPmOrg);
  const [ref, setRef] = useState("1:1–3");
  const [other, setOther] = useState(() => defaultOtherTester(session.username));
  const [visible, setVisible] = useState(false);
  const [inspection, setInspection] = useState<TestScenarioInspection | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TestScenarioResult | null>(null);
  const [ranVisible, setRanVisible] = useState(false);

  function setBusy(next: boolean) {
    setBusyState(next);
    onBusyChange(next);
  }

  function reset() {
    setInspection(null);
    setConfirming(false);
    setTyped("");
  }

  async function inspect() {
    setBusy(true);
    setError("");
    setResult(null);
    reset();
    try {
      setInspection(
        await inspectTestScenario({
          session,
          pmOrg: pmOrg.trim(),
          owner: owner.trim(),
          repo: repo.trim(),
          book: book.trim().toUpperCase(),
          ref: ref.trim(),
          resourceLabel: RESOURCE_LABEL,
          other: other.trim(),
          runTag: testRunTag(new Date()),
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!inspection) return;
    setBusy(true);
    setError("");
    setRanVisible(visible);
    try {
      const done = await runTestScenario(inspection, { typedConfirm: typed, visible, onProgress: setResult });
      setResult(done);
      if (done.error) setError(done.error);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const plan = inspection?.plan ?? null;
  const runBlock = plan ? testScenarioRunBlock(plan, typed) : "Comprueba primero.";

  return (
    <section className="qa-admin__section" aria-labelledby="qa-test-title">
      <h3 id="qa-test-title" className="qa-admin__section-title">Preparar una prueba</h3>
      <p className="qa-admin__hint">
        Crea dos subtareas «prueba» de la misma porción, una para ti y otra para el segundo usuario,
        cada una con su rama w/… desde la misma punta del tronco y un texto distinto en el primer
        versículo. El tronco no se toca: el siguiente Cerrar detecta el conflicto.
      </p>

      <div className="qa-admin__grid">
        <Label htmlFor="qa-test-pm">Organización PM</Label>
        <Input
          id="qa-test-pm"
          value={pmOrg}
          onChange={(e) => {
            setPmOrg(e.target.value);
            reset();
          }}
        />
        <Label htmlFor="qa-test-ref">Porción ({book || "—"} · {RESOURCE_LABEL})</Label>
        <Input
          id="qa-test-ref"
          value={ref}
          onChange={(e) => {
            setRef(e.target.value);
            reset();
          }}
        />
        <Label htmlFor="qa-test-other">Segundo usuario</Label>
        <Input
          id="qa-test-other"
          value={other}
          placeholder="login de DCS"
          autoComplete="off"
          onChange={(e) => {
            setOther(e.target.value.trim());
            reset();
          }}
        />
      </div>
      <label className="qa-admin__check">
        <Checkbox checked={visible} onCheckedChange={setVisible} disabled={busy} />
        <span>Dejar el conflicto ya visible</span>
      </label>
      {visible ? (
        <p className="qa-admin__hint">
          Tras los dos commits se ejecuta Cerrar en la primera subtarea (llega al tronco sin conflicto)
          y luego en la segunda, que choca y deja la tarjeta de decisión en las dos conversaciones.
          Ambas issues quedan cerradas.
        </p>
      ) : null}

      <div className="qa-admin__actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !pmOrg.trim() || !owner.trim() || !repo.trim() || !book.trim()}
          onClick={() => void inspect()}
        >
          {busy && !confirming ? "Comprobando…" : "Comprobar prueba"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy || !plan || Boolean(plan.block)}
          title={plan?.block ?? undefined}
          onClick={() => {
            setTyped("");
            setConfirming(true);
          }}
        >
          Preparar prueba…
        </Button>
      </div>

      {inspection && plan ? (
        <dl className="qa-admin__probe">
          <dt>Issue de origen</dt>
          <dd>
            <a href={inspection.source.html_url} target="_blank" rel="noreferrer">
              #{inspection.source.number}
            </a>{" "}
            {inspection.source.title}
          </dd>
          <dt>Tarea</dt>
          <dd><code>{inspection.input.taskId || "—"}</code></dd>
          <dt>Tronco</dt>
          <dd><code>{plan.trunkName}</code></dd>
          <dt>Tronco: acción</dt>
          <dd>{trunkActionText(inspection)}</dd>
          <dt>Ramas / archivos</dt>
          <dd>
            ramas: {seen(inspection.input.trunk.branchApi)}, archivo: {seen(inspection.input.trunk.fileApi)}
          </dd>
          {plan.issues.map((row, i) => (
            <PlanIssueRows key={row.assignee || i} index={i} row={row} />
          ))}
        </dl>
      ) : null}
      {plan?.block ? <p className="qa-admin__hint">No se puede preparar: {plan.block}</p> : null}

      {confirming && plan ? (
        <div className="qa-admin__confirm" role="group" aria-label="Confirmar la prueba">
          <p className="qa-admin__confirm-title">Se va a escribir en {session.host}:</p>
          <ul className="qa-admin__list">
            <li>
              Tronco <code>{plan.trunkName}</code>: {trunkActionText(inspection!)}. Nunca POST git/refs.
            </li>
            {plan.issues.map((row) => (
              <li key={row.title}>
                Issue en {pmOrg}/gateway-tasks «{row.title}» asignada a @{row.assignee}
                {row.predictedNumber ? ` (previsto #${row.predictedNumber})` : ""}; rama{" "}
                <code>{row.workRef}</code> por POST /branches desde la punta del tronco; un commit en{" "}
                {inspection!.input.filepath} con «{row.verseText}»; un PR de esa rama al tronco.
              </li>
            ))}
            {visible ? <li>Después: Cerrar en la primera issue y luego en la segunda.</li> : null}
          </ul>
          {plan.needsTypedConfirm ? (
            <div className="qa-admin__grid">
              <Label htmlFor="qa-test-confirm">Escribe la ref</Label>
              <Input
                id="qa-test-confirm"
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          ) : null}
          {runBlock && typed ? <p className="qa-admin__hint">{runBlock}</p> : null}
          <div className="qa-admin__actions">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button type="button" size="sm" disabled={busy || Boolean(runBlock)} onClick={() => void run()}>
              {busy ? "Preparando…" : "Confirmar y preparar"}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {result ? <ResultPanel result={result} visible={ranVisible} /> : null}
    </section>
  );
}

function PlanIssueRows({ index, row }: { index: number; row: TestScenarioInspection["plan"]["issues"][number] }) {
  return (
    <>
      <dt>Issue {index + 1}</dt>
      <dd>
        {row.title}
        {row.predictedNumber ? ` (previsto #${row.predictedNumber})` : ""}
      </dd>
      <dt>Rama {index + 1}</dt>
      <dd><code>{row.workRef || "—"}</code></dd>
      <dt>Texto {index + 1}</dt>
      <dd>{row.verseText || "—"}</dd>
    </>
  );
}

function ResultPanel({ result, visible }: { result: TestScenarioResult; visible: boolean }) {
  const ready = !result.error && result.rows.length === 2 && result.rows.every((r) => r.pullNumber);
  return (
    <div className="qa-admin__result" aria-live="polite">
      <p className="qa-admin__confirm-title">Resultado</p>
      <dl className="qa-admin__probe">
        <dt>Tronco</dt>
        <dd>
          <code>{result.trunkName}</code>
          {result.trunkSha ? <> · <code>{result.trunkSha.slice(0, 12)}</code></> : null}
          {result.trunkAction ? ` · ${result.trunkAction}` : null}
        </dd>
        <dt>Tronco, primer versículo</dt>
        <dd>{result.trunkVerse ?? "—"}</dd>
        {result.rows.map((row) => (
          <ResultRow key={row.issue} row={row} />
        ))}
      </dl>
      {result.closes.length ? (
        <ul className="qa-admin__list">
          {result.closes.map((c) => (
            <li key={c.issue}>
              Cerrar #{c.issue}: {c.status === "verses" ? "versículos en el tronco" : c.status}
              {c.conflicts ? ` · ${c.conflicts} conflicto(s)` : " · sin conflicto"}
              {c.postedOn.length ? ` · tarjeta en ${c.postedOn.map((n) => `#${n}`).join(" y ")}` : ""}
              {c.publishError ? ` · no se pudo publicar: ${c.publishError}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {ready && !visible ? (
        <Alert>
          <AlertDescription>
            Listo: #{result.rows[0]!.issue} (@{result.rows[0]!.login}) y #{result.rows[1]!.issue} (@
            {result.rows[1]!.login}). Cierra una subtarea y luego la otra.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function ResultRow({ row }: { row: TestScenarioResult["rows"][number] }) {
  return (
    <>
      <dt>Issue</dt>
      <dd>
        {row.issueUrl ? (
          <a href={row.issueUrl} target="_blank" rel="noreferrer">#{row.issue}</a>
        ) : (
          `#${row.issue}`
        )}{" "}
        · @{row.login}
        {row.pullNumber ? ` · PR #${row.pullNumber}` : ""}
      </dd>
      <dt>Rama</dt>
      <dd><code>{row.workRef}</code></dd>
      <dt>API de ramas / archivos</dt>
      <dd>{seen(row.branchApi)} / {seen(row.fileApi)}</dd>
      <dt>Primer versículo</dt>
      <dd>{row.verse ?? "—"}</dd>
    </>
  );
}

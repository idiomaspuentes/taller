import {
  createIssue,
  DcsApiError,
  editIssue,
  listRepoIssues,
  type DcsIssue,
} from "@ip-lms/dcs-client";
import {
  isProductionHost,
  planTestScenario,
  sourceIssueTitle,
  testIssueBody,
  testIssueLabelIds,
  testScenarioRunBlock,
  usfmVerseText,
  type RefRepairContext,
  type TestScenarioInput,
  type TestScenarioPlan,
} from "../domain/qaAdmin";
import {
  bookOnlyBranchName,
  portionPrBranchName,
  upsertPortionPrInBody,
  type PortionPrMarker,
} from "../domain/portionPr";
import { PM_REPO_NAME } from "../domain/types";
import { applyVerseEdits } from "../domain/usfmEdit";
import { parseWorkOrderMarker } from "../domain/workOrder";
import { bookUsfmName } from "../prep/discover";
import type { GtSession } from "./auth";
import { resolveBookBranchName } from "./bookBootstrap";
import { closeSubtask } from "./closeSubtask";
import { dcsConfig } from "./config";
import { loadPmConfig } from "./issues";
import { getPmIssue } from "./portionPr";
import { createPull, getDefaultBranch } from "./pulls";
import {
  deleteGhostTrunkRef,
  fileApiSees,
  probeTrunkRef,
  readFileAtSha,
  recreateTrunkFromDefault,
  recreateTrunkFromSha,
  recreateWorkRefFromSha,
  type RefRepairTarget,
} from "./refRepair";
import { readRepoFile, writeRepoFile } from "./repoFile";

export type TestScenarioRequest = {
  session: GtSession;
  pmOrg: string;
  owner: string;
  repo: string;
  book: string;
  ref: string;
  resourceLabel: string;
  other: string;
  runTag: string;
};

export type TestScenarioInspection = {
  request: TestScenarioRequest;
  source: DcsIssue;
  input: TestScenarioInput;
  plan: TestScenarioPlan;
};

export type TestScenarioBranchRow = {
  issue: number;
  issueUrl: string;
  login: string;
  workRef: string;
  pullNumber: number | null;
  branchApi: boolean;
  fileApi: boolean;
  verse: string | null;
};

export type TestScenarioResult = {
  trunkName: string;
  trunkSha: string;
  trunkAction: string;
  trunkVerse: string | null;
  rows: TestScenarioBranchRow[];
  /** Only when «Dejar el conflicto ya visible» ran Cerrar. */
  closes: { issue: number; status: string; conflicts: number; postedOn: number[]; publishError: string }[];
  error: string;
};

function refuse(session: GtSession): void {
  if (isProductionHost(session.host)) {
    throw new DcsApiError(`Preparar una prueba no opera sobre ${session.host}.`, 403);
  }
}

function errorText(err: unknown): string {
  if (err instanceof DcsApiError) return `${err.message} (HTTP ${err.status})`;
  return err instanceof Error ? err.message : String(err);
}

async function findSourceIssue(req: TestScenarioRequest): Promise<DcsIssue> {
  const title = sourceIssueTitle(req.book, req.ref, req.resourceLabel);
  const rows = await listRepoIssues(dcsConfig(req.session.host), req.pmOrg, PM_REPO_NAME, {
    token: req.session.token,
    state: "all",
    type: "issues",
    q: title,
    limit: 50,
  });
  const source = rows
    .filter((row) => row.title.trim() === title && parseWorkOrderMarker(row.body))
    .sort((a, b) => a.number - b.number)[0];
  if (!source) {
    throw new Error(`No hay una issue «${title}» en ${req.pmOrg}/${PM_REPO_NAME} para clonar.`);
  }
  return source;
}

async function nextRepoIndex(req: TestScenarioRequest): Promise<number | null> {
  const config = dcsConfig(req.session.host);
  const latest = await Promise.all(
    (["issues", "pulls"] as const).map((type) =>
      listRepoIssues(config, req.pmOrg, PM_REPO_NAME, {
        token: req.session.token,
        state: "all",
        type,
        limit: 1,
      }).catch(() => [] as DcsIssue[]),
    ),
  );
  const top = Math.max(0, ...latest.flat().map((row) => row.number));
  return top > 0 ? top + 1 : null;
}

/** Read-only: resolves the source issue, trunk, and everything the plan needs. */
export async function inspectTestScenario(req: TestScenarioRequest): Promise<TestScenarioInspection> {
  refuse(req.session);
  const config = dcsConfig(req.session.host);
  const source = await findSourceIssue(req);
  const taskId = parseWorkOrderMarker(source.body)?.teamId ?? "";
  const filepath = bookUsfmName(req.book);
  const target: RefRepairTarget = { session: req.session, owner: req.owner, repo: req.repo, filepath };
  const [defaultBranch, resolved, nextIssueNumber, open] = await Promise.all([
    getDefaultBranch(config, req.owner, req.repo, req.session.token),
    resolveBookBranchName({
      session: req.session,
      owner: req.owner,
      repo: req.repo,
      book: req.book,
      taskId,
      filepath,
    }),
    nextRepoIndex(req),
    listRepoIssues(config, req.pmOrg, PM_REPO_NAME, {
      token: req.session.token,
      state: "open",
      type: "issues",
      q: `prueba ${req.runTag}`,
      limit: 50,
    }),
  ]);
  const ctx: RefRepairContext = { defaultBranch, bookOnlyBranch: bookOnlyBranchName(req.book) };
  const [trunk, defaultHasFile] = await Promise.all([
    probeTrunkRef(target, resolved.bookBranch),
    fileApiSees(target, defaultBranch),
  ]);
  const ghostHasFile =
    trunk.gitRefSha && !trunk.branchApi ? (await readFileAtSha(target, trunk.gitRefSha)) !== null : null;
  const input: TestScenarioInput = {
    host: req.session.host,
    book: req.book,
    ref: req.ref,
    resourceLabel: req.resourceLabel,
    taskId,
    me: req.session.username,
    other: req.other,
    runTag: req.runTag,
    filepath,
    ctx,
    trunk,
    defaultHasFile,
    ghostHasFile,
    nextIssueNumber,
    existingTitles: open.map((row) => row.title.trim()),
  };
  return { request: req, source, input, plan: planTestScenario(input) };
}

/**
 * Trunk as a real branch (`POST /branches` only), two PM issues, two work
 * branches from the trunk SHA with a different first verse each, one PR per
 * issue stamped on its body. `visible` then runs Cerrar on the first and the
 * second issue so the conflict decision is already posted.
 */
export async function runTestScenario(
  confirmed: TestScenarioInspection,
  opts: { typedConfirm: string; visible: boolean; onProgress?: (r: TestScenarioResult) => void },
): Promise<TestScenarioResult> {
  const { session, pmOrg, owner, repo, book } = confirmed.request;
  refuse(session);
  const result: TestScenarioResult = {
    trunkName: confirmed.plan.trunkName,
    trunkSha: "",
    trunkAction: "",
    trunkVerse: null,
    rows: [],
    closes: [],
    error: "",
  };
  const report = () => opts.onProgress?.({ ...result, rows: [...result.rows], closes: [...result.closes] });

  try {
    const fresh = await inspectTestScenario(confirmed.request);
    const block = testScenarioRunBlock(fresh.plan, opts.typedConfirm);
    if (block) throw new Error(block);
    if (
      fresh.plan.trunkName !== confirmed.plan.trunkName
      || fresh.plan.trunk?.kind !== confirmed.plan.trunk?.kind
    ) {
      throw new Error("El tronco cambió desde la comprobación. Vuelve a comprobar antes de preparar.");
    }
    const { plan, input, source } = fresh;
    const scope = plan.scope!;
    const config = dcsConfig(session.host);
    const target: RefRepairTarget = { session, owner, repo, filepath: input.filepath };
    const trunkName = plan.trunkName;

    const action = plan.trunk!;
    let trunkSha = "";
    if (action.kind === "reuse") {
      trunkSha = action.sha;
      result.trunkAction = "reutilizado";
    } else {
      if (action.kind === "recreate-ghost") {
        await deleteGhostTrunkRef(target, trunkName, input.ctx, opts.typedConfirm);
      }
      const after = action.kind === "create"
        ? await recreateTrunkFromDefault(target, trunkName, input.ctx)
        : await recreateTrunkFromSha(target, trunkName, input.ctx, action.sha);
      if (!after.branchApi || !after.fileApi || !after.gitRefSha) {
        throw new Error(
          `Se creó «${trunkName}», pero API de ramas: ${after.branchApi ? "sí" : "no"}, API de archivos: ${after.fileApi ? "sí" : "no"}. Se detiene aquí.`,
        );
      }
      trunkSha = after.gitRefSha;
      result.trunkAction = action.kind === "create"
        ? `creado desde «${action.fromBranch}»`
        : `recreado desde ${action.sha.slice(0, 12)} (ref fantasma)`;
    }
    result.trunkSha = trunkSha;
    const trunkText = await readFileAtSha(target, trunkSha);
    if (trunkText == null) throw new Error(`No se pudo leer ${input.filepath} en ${trunkSha.slice(0, 12)}.`);
    result.trunkVerse = usfmVerseText(trunkText, scope.chapter, scope.from);
    report();

    const namespaceId = (await loadPmConfig(session, pmOrg)).namespaceId;
    const created: DcsIssue[] = [];
    for (const row of plan.issues) {
      created.push(
        await createIssue(config, pmOrg, PM_REPO_NAME, {
          token: session.token,
          title: row.title,
          body: testIssueBody(source.body ?? "", {
            keySuffix: `prueba-${input.runTag}-${row.assignee}`,
            login: row.assignee,
          }),
          labels: testIssueLabelIds(source.labels ?? [], namespaceId),
          milestone: source.milestone?.id,
          assignees: [row.assignee],
        }),
      );
    }

    for (let i = 0; i < created.length; i++) {
      const issue = created[i]!;
      const row = plan.issues[i]!;
      const workRef = portionPrBranchName({
        book,
        username: row.assignee,
        taskId: input.taskId,
        issueNumber: issue.number,
      });
      const entry: TestScenarioBranchRow = {
        issue: issue.number,
        issueUrl: issue.html_url || "",
        login: row.assignee,
        workRef,
        pullNumber: null,
        branchApi: false,
        fileApi: false,
        verse: null,
      };
      result.rows.push(entry);
      report();

      await recreateWorkRefFromSha(target, workRef, input.ctx, trunkSha);
      await writeRepoFile({
        session,
        owner,
        repo,
        filepath: input.filepath,
        branch: workRef,
        content: applyVerseEdits(trunkText, scope.chapter, [{ verse: scope.from, text: row.verseText }]),
        message: `Prueba QA #${issue.number}: ${book} ${scope.chapter}:${scope.from}, versión de ${row.assignee}`,
      });
      const pull = await createPull(config, owner, repo, {
        title: `${book} ${input.ref} · prueba (#${issue.number})`,
        body: [
          `Subtarea PM: ${issue.html_url || `#${issue.number}`}`,
          "",
          "Prueba de conflicto preparada desde Administración (QA).",
        ].join("\n"),
        head: workRef,
        base: trunkName,
        token: session.token,
      });
      const marker: PortionPrMarker = {
        schema: "gateway-portion-pr-1",
        owner,
        repo,
        number: pull.number,
        htmlUrl: pull.html_url || "",
        head: pull.head?.ref || workRef,
        base: pull.base?.ref || trunkName,
        issueNumber: issue.number,
      };
      await editIssue(config, pmOrg, PM_REPO_NAME, issue.number, {
        token: session.token,
        body: upsertPortionPrInBody(issue.body, marker),
      });
      entry.pullNumber = pull.number;

      const probe = await probeTrunkRef(target, workRef);
      entry.branchApi = probe.branchApi;
      entry.fileApi = probe.fileApi;
      if (probe.fileApi) {
        const onBranch = await readRepoFile({ ...target, branch: workRef });
        entry.verse = usfmVerseText(onBranch.text, scope.chapter, scope.from);
      }
      report();
    }

    if (opts.visible) {
      const resource = parseWorkOrderMarker(source.body)?.resource || "tpl";
      for (const row of result.rows) {
        const issue = await getPmIssue(session, pmOrg, row.issue);
        const closed = await closeSubtask({ session, pmOrg, issue, resource });
        result.closes.push({
          issue: row.issue,
          status: closed.merge.status,
          conflicts: closed.merge.conflicts.length,
          postedOn: closed.posted?.postedOn ?? [],
          publishError: closed.publishError,
        });
        report();
      }
    }
  } catch (err) {
    result.error = errorText(err);
  }
  report();
  return result;
}

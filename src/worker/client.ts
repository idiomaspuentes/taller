import type { InventoryDoc } from "../domain/types";
import { isInventoryDoc, normalizeInventory } from "../domain/store";

const WORKER_URLS = ["http://127.0.0.1:8765", "http://localhost:8765"];

export type WorkerJob = {
  id: string;
  book?: string;
  lang?: string;
  contentOrg?: string;
  status: "queued" | "running" | "done" | "error";
  step?: string;
  message?: string;
  error?: string | null;
  result?: unknown;
};

let workerBase = WORKER_URLS[0];

export function getWorkerBase(): string {
  return workerBase;
}

export async function checkWorker(): Promise<boolean> {
  for (const base of WORKER_URLS) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { ok?: boolean };
      if (body.ok) {
        workerBase = base;
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

export async function startJob(params: {
  book: string;
  lang: string;
  contentOrg: string;
  fixture?: boolean;
}): Promise<{ id: string; status: string }> {
  const res = await fetch(`${workerBase}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as {
    id?: string;
    status?: string;
    error?: string;
  };
  if (res.status === 409 && body.id) {
    return { id: body.id, status: "running" };
  }
  if (!res.ok || !body.id) {
    throw new Error(body.error || `No se pudo crear el trabajo (${res.status}).`);
  }
  return { id: body.id, status: body.status || "queued" };
}

export async function getJob(id: string): Promise<WorkerJob> {
  const res = await fetch(`${workerBase}/jobs/${id}`);
  if (!res.ok) {
    throw new Error(`Trabajo no encontrado (${res.status}).`);
  }
  return (await res.json()) as WorkerJob;
}

export async function pollJob(
  id: string,
  onUpdate?: (job: WorkerJob) => void,
  maxMs = 15 * 60 * 1000,
): Promise<InventoryDoc> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const job = await getJob(id);
    onUpdate?.(job);
    if (job.status === "done") {
      if (!isInventoryDoc(job.result)) {
        throw new Error("El worker devolvió un JSON inválido.");
      }
      return normalizeInventory(job.result);
    }
    if (job.status === "error") {
      throw new Error(job.error || job.message || "Error en el worker.");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Tiempo de espera agotado. Revisa el worker.");
}

/**
 * Talks to inventoryWorker.ts, a real browser Web Worker — no local process
 * to start, no health check needed (creating the Worker either succeeds or
 * the browser doesn't support Workers at all; failures happen per-request,
 * e.g. a book that fails to download).
 */

import type { InventoryDoc } from "../domain/types";
import { isInventoryDoc, normalizeInventory } from "../domain/store";
import type { GenerateRequest, WorkerResponse } from "./protocol";

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./inventoryWorker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

export function generateInventory(
  params: { book: string; lang: string; contentOrg: string },
  onProgress: (message: string) => void,
): Promise<InventoryDoc> {
  const w = getWorker();
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    function handleMessage(event: MessageEvent<WorkerResponse>) {
      const msg = event.data;
      if (msg.requestId !== requestId) return;

      if (msg.type === "progress") {
        onProgress(msg.message);
        return;
      }
      w.removeEventListener("message", handleMessage);
      if (msg.type === "error") {
        reject(new Error(msg.message));
        return;
      }
      if (!isInventoryDoc(msg.result)) {
        reject(new Error("El worker devolvió un JSON inválido."));
        return;
      }
      resolve(normalizeInventory(msg.result));
    }

    w.addEventListener("message", handleMessage);
    const request: GenerateRequest = { type: "generate", requestId, ...params };
    w.postMessage(request);
  });
}

/** Message shapes shared between the main thread and inventoryWorker.ts. */

export type GenerateRequest = {
  type: "generate";
  requestId: string;
  book: string;
  lang: string;
  contentOrg: string;
  /** Where the portions of a chapter start, by chapter, when the project cut them its own way. */
  portionStarts?: Record<number, number[]>;
};

export type ProgressMessage = { type: "progress"; requestId: string; message: string };
export type ResultMessage = { type: "result"; requestId: string; result: Record<string, unknown> };
export type ErrorMessage = { type: "error"; requestId: string; message: string };

export type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage;

/**
 * Read → merge → write loop for the book trunk. Pure: DCS I/O is injected
 * so Cerrar and the verify script share the same retry rules.
 */

import type { UsfmVerseMergeResult } from "./usfmVerseMerge";

export type TrunkIo = {
  read(): Promise<{ text: string; sha?: string }>;
  write(text: string, sha: string | undefined): Promise<void>;
  isShaConflict(err: unknown): boolean;
  /** Runs before every `write`; if it throws, nothing is written. */
  beforeWrite?(result: UsfmVerseMergeResult): Promise<void>;
  /** Error when every attempt lost the SHA race (defaults to the Cerrar wording). */
  exhaustedMessage?: string;
};

/** `compute` runs once per attempt, so it can re-read the work branch too. */
export async function mergeIntoTrunkWithRetry(
  io: TrunkIo,
  compute: (trunkText: string) => UsfmVerseMergeResult | Promise<UsfmVerseMergeResult>,
  maxAttempts = 3,
): Promise<{ result: UsfmVerseMergeResult; wrote: boolean; attempts: number }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { text, sha } = await io.read();
    const result = await compute(text);
    if (result.usfm === text) return { result, wrote: false, attempts: attempt };
    await io.beforeWrite?.(result);
    try {
      await io.write(result.usfm, sha);
      return { result, wrote: true, attempts: attempt };
    } catch (err) {
      if (!io.isShaConflict(err)) throw err;
    }
  }
  throw new Error(
    io.exhaustedMessage ??
      `El borrador grupal cambió mientras se guardaba (${maxAttempts} intentos). Vuelve a pulsar Cerrar.`,
  );
}

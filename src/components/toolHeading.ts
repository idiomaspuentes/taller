import { bookLabel } from "../domain/books";
import type { SolverLaunchContext } from "../domain/solverLaunch";
import { localizeName } from "../domain/templateNames";

/**
 * What every tool says at its top, the same way: the passage in hand as the title ("3 Juan 1:5–8") and, under it,
 * the step and the task it belongs to. A tool that put its own name there, with the book as a code, did not look
 * like the next step of the same work.
 */
export function toolHeading(
  ctx: Pick<SolverLaunchContext, "book" | "ref" | "chapter" | "stepName" | "taskName"> | null | undefined,
  language: "es" | "pt",
  /** The name of the step as the tool knows it, for when the launch did not carry one. */
  stepName: string,
): { title: string; where: string } {
  if (!ctx?.book) return { title: stepName, where: "" };
  const step = ctx.stepName ? localizeName(ctx.stepName, language) : stepName;
  const task = ctx.taskName ? localizeName(ctx.taskName, language) : "";
  return {
    // A passage follows its book («Judas 1:5–8»); an article or work added by hand is named apart from it.
    title: [bookLabel(ctx.book.toUpperCase(), language), String(ctx.ref || ctx.chapter || "")].filter(Boolean).join(/^\d/.test(String(ctx.ref || ctx.chapter || "")) ? " " : " · "),
    where: [step, task && task !== step ? task : ""].filter(Boolean).join(" · "),
  };
}

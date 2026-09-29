/** Join truthy class-name fragments — no Tailwind, so no conflict-merging needed. */
export function cn(...values: Array<string | number | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

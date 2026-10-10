/**
 * How large the texts that are read and written in the tools are drawn: the translation, what it is read against,
 * the original. A person chooses it once, on their device, and every tool follows. It is the texts that grow, not
 * the buttons and the names around them: on a phone those have no room to spare.
 */
export type TextSize = "normal" | "large" | "larger";

export const TEXT_SIZES: TextSize[] = ["normal", "large", "larger"];

/** How many times the size the tools were drawn in. */
export const TEXT_SCALE: Record<TextSize, number> = { normal: 1, large: 1.15, larger: 1.3 };

/** What was kept on the device, read back: anything else is the size the tools come with. */
export function asTextSize(raw: unknown): TextSize {
  return TEXT_SIZES.includes(raw as TextSize) ? (raw as TextSize) : "normal";
}

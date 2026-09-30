import type { AlignmentGroup } from "@usfm-tools/types";
import { textFingerprint } from "./reviewRound";

const plain = (word: string) => word.replace(/[^\p{L}\p{N}\p{M}]/gu, "");

/**
 * What a reviewer sees of a verse: the words of the draft and every link. An answer,
 * a «Terminé» mark or a proposal carries this, so any change to the text or to the
 * alignment makes them stale by itself. Punctuation is ignored: saving a linked word
 * without its comma must not change the hash.
 */
export function alignmentHash(draftWords: string[], groups: AlignmentGroup[]): string {
  const links = groups.map(
    (g) => `${g.sources.map((s) => `${s.content}#${s.occurrence}`).join("+")}=${g.targets.map((t) => `${plain(t.word)}#${t.occurrence}`).join("+")}`,
  );
  return textFingerprint(`${draftWords.map(plain).join(" ")}|${links.join(";")}`);
}

/** The links of a verse as short readable lines: «דִּבְרֵי → Las palabras de». */
export function groupsToLines(groups: AlignmentGroup[]): string[] {
  return groups.map((g) => `${g.sources.map((s) => s.content).join(" ")} → ${g.targets.map((t) => t.word).join(" ")}`);
}

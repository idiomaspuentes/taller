/**
 * The verses of a chapter a draft writes as one (`\v 4-5`), among the ones a passage covers, from the names its
 * verses are known by («JUD 1:4-5»). They are not aligned yet: the alignment screen takes a verse of the draft
 * against the same verse of the original, and these are one verse of the draft against two. They are told, so
 * that nobody thinks the passage has no such verses.
 */
export function joinedVerses(sids: string[], chapter: number, covered: { from: number; to: number } | null): { from: number; to: number }[] {
  return sids
    .flatMap((sid) => {
      const m = /(\d+):(\d+)\s*[-–]\s*(\d+)\s*$/.exec(sid);
      return m && Number(m[1]) === chapter ? [{ from: Number(m[2]), to: Number(m[3]) }] : [];
    })
    .filter((span) => !covered || (span.to >= covered.from && span.from <= covered.to))
    .sort((a, b) => a.from - b.from);
}

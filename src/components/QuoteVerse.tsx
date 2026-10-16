import { tokenizeVersePlainText } from "../domain/helpQuoteMatch";

/**
 * A verse with the words a quote points at marked. With `onToggle`, each word can be marked or unmarked. `target`:
 * the help a touch on a word leads to, when another help of the verse is about it (see `verseCoverage`); those
 * words are underlined. The words of the help in view are touched too when another help shares them.
 *
 * Words in a row that lead to the same help are one thing to touch, the phrase. Each was a button of its own, as
 * wide as its word: «de» was 20 px. The phrase is not made taller than its line (31 px): at 44 a verse of three
 * lines would take 132 px instead of 77, and the two texts are what a note is read under.
 */
export function QuoteVerse({ text, marked, onToggle, target, onOpen }: { text: string; marked: number[]; onToggle?: (index: number) => void; target?: (index: number) => string | undefined; onOpen?: (helpId: string) => void }) {
  const tokens = tokenizeVersePlainText(text);
  const on = new Set(marked);
  if (onToggle) {
    return (
      <span className="ck-verse">
        {tokens.map((token, index) => (
          <button key={index} type="button" className="ck-word" aria-pressed={on.has(index)} onClick={() => onToggle(index)}>
            {token}
          </button>
        ))}
      </span>
    );
  }
  const runs: { to?: string; here: boolean; words: string[]; at: number }[] = [];
  tokens.forEach((token, index) => {
    const to = onOpen ? target?.(index) : undefined;
    const here = on.has(index);
    const last = runs[runs.length - 1];
    if (last && last.to === to && last.here === here) last.words.push(token);
    else runs.push({ to, here, words: [token], at: index });
  });
  return (
    <span className="ck-verse">
      {runs.map((run) =>
        run.to ? (
          <span key={run.at}>
            {/* Not a <button>: a phrase goes on to the next line, and a button does not break. */}
            <span
              role="button"
              tabIndex={0}
              className="ck-covered"
              data-here={run.here || undefined}
              onClick={() => onOpen!(run.to!)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpen!(run.to!);
              }}
            >
              {run.words.join(" ")}
            </span>{" "}
          </span>
        ) : (
          <span key={run.at}>
            {run.here ? <mark>{run.words.join(" ")}</mark> : run.words.join(" ")}{" "}
          </span>
        ),
      )}
    </span>
  );
}

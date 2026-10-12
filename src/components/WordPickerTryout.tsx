import { useState } from "react";
import { ToolHeader } from "./ToolHeader";
import { WordPicker } from "./WordPicker";
import { selectionFromWords, stretchesOf, wordSpans } from "../domain/afinacionSelection";
import { useT } from "../i18n/messages";

/**
 * Verses to try the marking of words on, with what a note marks in the original. They are examples, not a task:
 * the draft is the one a team of the test server had, and nothing here is read from Door43 or written to it.
 */
const EXAMPLES = [
  {
    id: "long",
    name: "sp.exLong",
    ref: "Jonás 2:2",
    original: "וַ⁠יֹּ֗אמֶר קָ֠רָאתִי מִ⁠צָּ֥רָה לִ֛⁠י אֶל־יְהוָ֖ה וַֽ⁠יַּעֲנֵ֑⁠נִי מִ⁠בֶּ֧טֶן שְׁא֛וֹל שִׁוַּ֖עְתִּי שָׁמַ֥עְתָּ קוֹלִֽ⁠י׃",
    marked: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    draft: "Y él dijo: Clamé a Jehová desde mi angustia y él me contestó; desde el vientre del Seol clamé, tú escuchaste mi voz.",
  },
  {
    id: "apart",
    name: "sp.exApart",
    ref: "Tito 1:1",
    original: "Παῦλος, δοῦλος Θεοῦ, ἀπόστολος δὲ Ἰησοῦ Χριστοῦ",
    marked: [1, 3],
    draft: "Pablo, siervo de Dios y apóstol de Jesucristo",
  },
  {
    id: "stretches",
    name: "sp.exStretches",
    ref: "Judas 1:15",
    original: "ποιῆσαι κρίσιν κατὰ πάντων, καὶ ἐλέγξαι πᾶσαν ψυχὴν",
    marked: [0, 1, 2, 3, 5, 6, 7],
    draft: "para hacer juicio contra todos y para reprender a toda alma",
  },
] as const;

/**
 * A page to try how words are marked, outside any task (`#/prueba/seleccion`): the same piece the review of
 * challenges and key terms uses (`WordPicker`), over example verses, with what would be kept of the marks said
 * underneath. It needs no session.
 */
export function WordPickerTryout({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [at, setAt] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const example = EXAMPLES[at]!;
  const kept = selectionFromWords(example.draft, selected, { chapter: 1, verse: 1 });
  const stretches = stretchesOf(selected);
  const words = wordSpans(example.draft);
  return (
    <div className="af">
      <ToolHeader title={t("sp.title")} meta={t("sp.meta")} onBack={onClose} />
      <div className="fam-tabs af-panes" role="tablist" aria-label={t("sp.examples")}>
        {EXAMPLES.map((row, i) => (
          <button
            key={row.id}
            type="button"
            role="tab"
            className="fam-tab"
            aria-selected={i === at}
            onClick={() => {
              setAt(i);
              setSelected([]);
            }}
          >
            {t(row.name)}
          </button>
        ))}
      </div>
      <section className="af-focus" aria-label={t("sp.title")}>
        <p className="af-kind af-kind--top">{example.ref}</p>
        <p className="af-stepname">{t("af.step1")}</p>
        <div className="af-ref">
          <div className="af-ref__bar">
            <span className="af-lbl">{t("af.refLabel")}</span>
          </div>
          <span className="af-orig">
            <span className="af-words" dir={at === 0 ? "rtl" : undefined}>
              {wordSpans(example.original).map((word) => (
                <span key={word.index} className="af-word" data-marked={(example.marked as readonly number[]).includes(word.index) ? "true" : undefined}>
                  {word.text}
                </span>
              ))}
            </span>
          </span>
        </div>
        <div className="af-draft">
          <div className="af-draft__bar">
            <span className="af-draft__name">
              <span className="af-lbl">{t("af.draftLabel2")}</span>
              <span className="af-res">TPL</span>
            </span>
          </div>
          <WordPicker text={example.draft} selected={selected} onChange={setSelected} />
          <p className="af-hint">
            {t("af.tapMarked").replace("{res}", "TPL").replace("{marked}", t("af.theMarked"))} {t("af.runHint")}
          </p>
        </div>
        {/* What the task would keep of these marks: said here, since nothing is saved. */}
        <div className="af-recap sp-kept" aria-live="polite">
          <p className="af-lbl">{t("sp.kept")}</p>
          {kept ? (
            <ol>
              {stretches.map((stretch) => (
                <li key={stretch.from}>
                  {words
                    .slice(stretch.from, stretch.to + 1)
                    .map((word) => word.text)
                    .join(" ")}
                </li>
              ))}
            </ol>
          ) : (
            <p className="af-hint">{t("af.nothingChosen")}</p>
          )}
          <p className="af-hint">{t(stretches.length > 1 ? "sp.keptMany" : "sp.keptOne").replace("{n}", String(stretches.length)).replace("{words}", String(selected.length))}</p>
        </div>
        <p className="af-hint">{t("sp.nothingSaved")}</p>
      </section>
    </div>
  );
}

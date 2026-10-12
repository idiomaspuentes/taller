import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ToolHeader } from "./ToolHeader";
import { WordPicker } from "./WordPicker";
import { WordPickerEnds } from "./WordPickerEnds";
import { WordPickerPhrases } from "./WordPickerPhrases";
import { selectionFromWords, stretchesOf, wordSpans } from "../domain/afinacionSelection";
import { useT } from "../i18n/messages";

/**
 * Verses to try the marking of words on, with what a note marks in the original. They are examples, not a task:
 * nothing here is read from Door43 or written to it. `proposed` is what the app would mark by itself in proposal
 * B; it is written by hand here, and in the last example it is left two words short on purpose, to try how a
 * proposal that is nearly right is put right.
 */
const EXAMPLES = [
  {
    name: "sp.exLong",
    ref: "Jonás 2:2",
    rtl: true,
    original: "וַ⁠יֹּ֗אמֶר קָ֠רָאתִי מִ⁠צָּ֥רָה לִ֛⁠י אֶל־יְהוָ֖ה וַֽ⁠יַּעֲנֵ֑⁠נִי מִ⁠בֶּ֧טֶן שְׁא֛וֹל שִׁוַּ֖עְתִּי שָׁמַ֥עְתָּ קוֹלִֽ⁠י׃",
    marked: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    draft: "Y él dijo: Clamé a Jehová desde mi angustia y él me contestó; desde el vientre del Seol clamé, tú escuchaste mi voz.",
    proposed: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
  },
  {
    name: "sp.exApart",
    ref: "Tito 1:1",
    rtl: false,
    original: "Παῦλος, δοῦλος Θεοῦ, ἀπόστολος δὲ Ἰησοῦ Χριστοῦ",
    marked: [1, 3],
    draft: "Pablo, siervo de Dios y apóstol de Jesucristo",
    proposed: [1, 5],
  },
  {
    name: "sp.exStretches",
    ref: "Judas 1:15",
    rtl: false,
    original: "ποιῆσαι κρίσιν κατὰ πάντων, καὶ ἐλέγξαι πᾶσαν ψυχὴν",
    marked: [0, 1, 2, 3, 5, 6, 7],
    draft: "para hacer juicio contra todos y para reprender a toda alma",
    proposed: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10],
  },
  {
    name: "sp.exOneAndRun",
    ref: "Jonás 1:3",
    rtl: true,
    original: "וַ⁠יָּ֤קָם יוֹנָה֙ לִ⁠בְרֹ֣חַ תַּרְשִׁ֔ישָׁ⁠ה מִ⁠לִּ⁠פְנֵ֖י יְהוָ֑ה",
    marked: [1, 4, 5],
    draft: "Pero Jonás se levantó para huir a Tarsis, lejos de la presencia de Jehová",
    proposed: [1, 10, 11, 12, 13],
  },
] as const;

const VARIANTS = [
  { id: "phrases", name: "sp.varPhrases", about: "sp.aboutPhrases" },
  { id: "ends", name: "sp.varEnds", about: "sp.aboutEnds" },
  { id: "now", name: "sp.varNow", about: "sp.aboutNow" },
] as const;

/**
 * A page to try how words are marked, outside any task (`#/prueba/seleccion`): two proposals and the way the
 * review of challenges and key terms has today, over the same example verses, with what would be kept of the
 * marks said underneath. It needs no session.
 */
export function WordPickerTryout({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [variant, setVariant] = useState<(typeof VARIANTS)[number]["id"]>("phrases");
  const [at, setAt] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const example = EXAMPLES[at]!;
  /** The example as it opens: with the app's proposal marked where the proposal is tried, with nothing elsewhere. */
  const open = (which: typeof variant, index: number) => {
    setVariant(which);
    setAt(index);
    setSelected(which === "ends" ? [...EXAMPLES[index]!.proposed] : []);
  };
  const kept = selectionFromWords(example.draft, selected, { chapter: 1, verse: 1 });
  const stretches = stretchesOf(selected);
  const words = wordSpans(example.draft);
  const about = VARIANTS.find((row) => row.id === variant)!.about;
  return (
    <div className="af">
      <ToolHeader title={t("sp.title")} meta={t("sp.meta")} onBack={onClose} />
      <div className="fam-tabs af-panes" role="tablist" aria-label={t("sp.variants")}>
        {VARIANTS.map((row) => (
          <button key={row.id} type="button" role="tab" className="fam-tab" aria-selected={row.id === variant} onClick={() => open(row.id, at)}>
            {t(row.name)}
          </button>
        ))}
      </div>
      <section className="af-focus" aria-label={t("sp.title")}>
        <p className="af-hint sp-about">{t(about)}</p>
        <div className="af-focus__top">
          <p className="af-kind af-kind--top">
            {t(example.name)} · {example.ref}
          </p>
          <span className="af-step">
            <button type="button" className="th-icon" aria-label={t("sp.prevExample")} title={t("sp.prevExample")} disabled={at === 0} onClick={() => open(variant, at - 1)}>
              <ChevronLeft size={18} aria-hidden />
            </button>
            <span className="af-count">
              {at + 1} / {EXAMPLES.length}
            </span>
            <button type="button" className="th-icon" aria-label={t("sp.nextExample")} title={t("sp.nextExample")} disabled={at === EXAMPLES.length - 1} onClick={() => open(variant, at + 1)}>
              <ChevronRight size={18} aria-hidden />
            </button>
          </span>
        </div>
        <div className="af-ref">
          <div className="af-ref__bar">
            <span className="af-lbl">{t("af.refLabel")}</span>
          </div>
          <span className="af-orig">
            <span className="af-words" dir={example.rtl ? "rtl" : undefined}>
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
          {variant === "phrases" ? <WordPickerPhrases key={at} text={example.draft} selected={selected} onChange={setSelected} /> : null}
          {variant === "ends" ? <WordPickerEnds text={example.draft} selected={selected} onChange={setSelected} /> : null}
          {variant === "now" ? <WordPicker key={at} text={example.draft} selected={selected} onChange={setSelected} /> : null}
          <p className="af-hint">{t(variant === "phrases" ? "sp.askPhrases" : variant === "ends" ? "sp.askEnds" : "sp.askNow")}</p>
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
        </div>
        <p className="af-hint">{t("sp.nothingSaved")}</p>
      </section>
    </div>
  );
}

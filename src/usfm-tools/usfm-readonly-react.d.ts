import type { ComponentType, CSSProperties, MouseEvent } from "react";
import type { AlignmentMap } from "@usfm-tools/types";
import type { UsjDocument } from "./usj-core";

export type ParseUsfmOptions = { stripAlignment?: boolean };

export type UsfmReadonlyViewReadyPayload = {
  usj: UsjDocument;
  bookCode: string;
  chapters: readonly number[];
  chapterCount: number;
};

export type WordClickPayload = {
  word: string;
  surface: string;
  bookCode: string;
  chapter: number;
  verseNum: string;
  wordIndexInVerse: number;
  occurrenceInVerse: number;
  verseSid: string;
  gatewayTokenIndex?: number;
  event: MouseEvent<HTMLElement>;
};

export type WordDecorationInfo = {
  bookCode: string;
  chapter: number;
  verseNum: string;
  verseSid: string;
  surface: string;
  word: string;
  wordIndexInVerse: number;
  occurrenceInVerse: number;
  gatewayTokenIndex?: number;
};

export type UsfmReadonlyViewProps = {
  usfm?: string;
  usj?: UsjDocument | null;
  chapter?: number;
  parseOptions?: ParseUsfmOptions;
  stripAlignment?: boolean;
  className?: string;
  proseMirrorClassName?: string;
  "aria-label"?: string;
  onReady?: (payload: UsfmReadonlyViewReadyPayload) => void;
  onVerseClick?: (verseNum: string, event: MouseEvent<HTMLElement>) => void;
  onWordClick?: (payload: WordClickPayload) => void;
  getWordDecoration?: (
    info: WordDecorationInfo,
  ) => { className?: string; style?: CSSProperties } | null | void;
};

export const UsfmReadonlyView: ComponentType<UsfmReadonlyViewProps>;
export function parseUsfmToUsj(usfm: string, options?: ParseUsfmOptions): UsjDocument | null;
export function parseUsfmToUsjWithAlignments(
  usfm: string,
  options?: ParseUsfmOptions,
): { usj: UsjDocument; alignments: AlignmentMap } | null;

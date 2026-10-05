/**
 * The place a comment is about, in the language the app is showing: «Párrafo 2», «Título», the verse. The words are
 * those of the notices (`noticeText.ts`), so a comment is named the same on a lock screen and in the conversation.
 */
import type { CommentPlace } from "./domain/commentPlace";
import { noticeLang, placeName as placeNameIn, placedLine } from "./domain/noticeText";
import { getUiLanguage } from "./i18n/language";

export const placeName = (place: CommentPlace): string => placeNameIn(place, noticeLang(getUiLanguage()));

/** One line about a message (under a task, in a list): the place in words where the message has one. */
export const placedPreview = (text: string): string => placedLine(text, noticeLang(getUiLanguage()));

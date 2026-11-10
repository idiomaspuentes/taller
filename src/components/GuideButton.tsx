import { CircleHelp } from "lucide-react";
import { guide, useGuidePart, useHasGuide } from "../guide";
import { useT } from "../i18n/messages";

/**
 * «Guía»: the guide of the screen on view, again, whenever somebody wants to remember how it goes. Always in the same
 * corner of the header, with its word (an icon alone says nothing on a phone), and only on a screen that has a guide.
 * Its own last step points at it, so whoever finishes a guide knows where to find it.
 */
export function GuideButton({ className }: { className?: string }) {
  const t = useT();
  const has = useHasGuide();
  useGuidePart("end", [{ id: "guide-button", seenKey: "guide-button", target: "guide-button", text: t("guide.buttonStep") }]);
  if (!has) return null;
  return (
    <button type="button" className={`guide-button${className ? ` ${className}` : ""}`} data-guide="guide-button" onClick={() => guide.replay()}>
      <CircleHelp size={18} aria-hidden />
      <span>{t("guide.button")}</span>
    </button>
  );
}

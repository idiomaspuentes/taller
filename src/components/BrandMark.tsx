import { appName, ORGANIZATION } from "../brand";
import { useUiLanguage } from "../i18n/language";

/** Puentes isotype + wordmark. The organization stays in the tooltip. */
export function BrandMark() {
  const name = appName(useUiLanguage());
  return (
    <div className="app-mark" title={`${name} · ${ORGANIZATION}`}>
      <img className="app-mark__logo" src="/puentes-isotipo.svg" alt="" width={26} height={22} />
      <span className="app-mark__word">{name.toLowerCase()}</span>
    </div>
  );
}

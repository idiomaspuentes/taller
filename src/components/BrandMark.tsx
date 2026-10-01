import { appName, appTitle, ORGANIZATION } from "../brand";
import { useUiLanguage } from "../i18n/language";

/** Puentes isotype + wordmark. The organization stays in the tooltip. */
export function BrandMark() {
  const language = useUiLanguage();
  const name = appName(language);
  return (
    <div className="app-mark" title={`${appTitle(language)} · ${ORGANIZATION}`}>
      <img className="app-mark__logo" src="/taller-isotipo.svg" alt="" width={26} height={22} />
      <span className="app-mark__word">{name.toLowerCase()}</span>
    </div>
  );
}

import { APP_NAME_FULL } from "../brand";

/** Puentes isotype + wordmark. The full product name stays in the tooltip. */
export function BrandMark() {
  return (
    <div className="app-mark" title={APP_NAME_FULL}>
      <img className="app-mark__logo" src="/puentes-isotipo.svg" alt="" width={26} height={22} />
      <span className="app-mark__word">tareas</span>
    </div>
  );
}

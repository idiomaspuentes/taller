/**
 * DCS's contents API is base64 in/out (API_DCS.md §4c). Works in both
 * the browser (where this actually ships) and Node (where the test
 * suite runs), without pulling in a dependency for it.
 */
export function encodeBase64(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf-8").toString("base64");
  }
  // btoa only handles Latin1, so UTF-8 bytes are escaped through it first.
  return btoa(unescape(encodeURIComponent(text)));
}

export function decodeBase64(base64: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf-8");
  }
  return decodeURIComponent(escape(atob(base64)));
}

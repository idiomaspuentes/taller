/**
 * Base64url for machine markers inside DCS comments
 * (`<!-- tas:verse-conflicts … -->`, `<!-- tas:chat-event … -->`).
 * Base64url because payload text may contain `}` or `-->`.
 */

export function encodeBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(encoded: string): string {
  let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

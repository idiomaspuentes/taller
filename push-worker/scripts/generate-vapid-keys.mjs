/**
 * Makes the VAPID key pair the push services use to know a push comes from this Worker.
 *   node scripts/generate-vapid-keys.mjs
 * Put the public key in the app (VITE_PUSH_PUBLIC_KEY is not needed: the Worker serves it) and set both
 * as Worker secrets:  wrangler secret put VAPID_PUBLIC_KEY   /   wrangler secret put VAPID_PRIVATE_KEY
 * Keep the private key secret; make a new pair only if it leaks (everybody must subscribe again).
 */
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicKey = b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);

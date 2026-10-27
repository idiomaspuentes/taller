import { request } from "@ip-lms/dcs-client";
import { dcsConfig } from "./config";
import { photoSource } from "./photos";
import { displayName, uploadedAvatar } from "../domain/profile";

/** A person as Door43 has them: the name they set (else their login) and the photo they put, if any. */
export type Door43Person = { name: string; avatarUrl?: string };

/**
 * Each person read once per server, for the faces of a list (27 October): a list of a chapter showed «AB» with
 * «abelper8» under the pointer, when Door43 knew «Abel E. Pérez» and his photo. Whoever cannot be read is their login.
 */
const known = new Map<string, Promise<Door43Person>>();

export function door43Person(login: string): Promise<Door43Person> {
  const source = photoSource();
  if (!source || !login) return Promise.resolve({ name: login });
  const key = `${source.session.host}|${login.toLowerCase()}`;
  let found = known.get(key);
  if (!found) {
    found = request<{ login?: string; full_name?: string; avatar_url?: string }>(dcsConfig(source.session.host), { method: "GET", path: `/users/${encodeURIComponent(login)}`, token: source.session.token })
      .then((user) => ({ name: displayName(user, login), avatarUrl: uploadedAvatar(user.avatar_url) }))
      .catch(() => ({ name: login }));
    known.set(key, found);
  }
  return found;
}

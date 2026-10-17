import { addTeamRepo, apiBase, createOrUpdateBinaryContents, createOrgRepo, deleteContents, getContents, getRepo, listOrgTeams } from "@ip-lms/dcs-client";
import type { GtSession } from "./auth";
import { dcsConfig } from "./config";
import { PHOTO_FOLDER, loginOfPhotoFile, photoPath } from "../domain/photos";
import { PHOTO_REPO_NAME } from "../domain/types";

/**
 * The photos of the people, in the private repository of the organization (see `domain/photos.ts`). It is private,
 * so an `<img>` could not show them: each is asked for with the session of whoever looks, and shown from this device.
 * Whoever has no access to the repository (no session, not in a team of the organization) sees none.
 */

type Source = { session: GtSession; org: string };
let source: Source | null = null;
const listeners = new Set<() => void>();
/** Who looks and in which organization: set by the app once somebody is signed in. */
export function setPhotoSource(next: Source | null): void {
  const same = source && next && source.org === next.org && source.session.token === next.session.token && source.session.host === next.session.host;
  if (same) return;
  source = next;
  index = null;
  listeners.forEach((listen) => listen());
}
export const photoSource = (): Source | null => source;
/** Something changed (a photo put or taken away, another person signed in): the faces on screen are read again. */
export function onPhotosChanged(listen: () => void): () => void {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

const INDEX_FRESH_MS = 5 * 60 * 1000;
/** Who has a photo, and the version of each: one question for the whole folder, every few minutes at most. */
let index: { at: number; key: string; photos: Promise<Map<string, string>> } | null = null;

const keyOf = (s: Source) => `${s.session.host}|${s.org}`;

export function photoIndex(s: Source = source!): Promise<Map<string, string>> {
  if (!PHOTO_REPO_NAME || !s?.session.token) return Promise.resolve(new Map());
  const key = keyOf(s);
  if (index && index.key === key && Date.now() - index.at < INDEX_FRESH_MS) return index.photos;
  const photos = getContents(dcsConfig(s.session.host), s.org, PHOTO_REPO_NAME, PHOTO_FOLDER, { token: s.session.token })
    .then((listing) => {
      const out = new Map<string, string>();
      for (const entry of Array.isArray(listing) ? listing : []) {
        const login = entry.type === "file" ? loginOfPhotoFile(entry.name) : undefined;
        if (login && entry.sha) out.set(login, entry.sha);
      }
      return out;
    })
    // No repository, no folder yet, or no access: nobody has a photo.
    .catch(() => new Map<string, string>());
  index = { at: Date.now(), key, photos };
  return photos;
}

/** The photos already turned into something an `<img>` can show, by person and version. */
const shown = new Map<string, Promise<string | null>>();
const CACHE = "taller-fotos";

/** The photo of a person to show, or null when they have none (or it cannot be read). */
export async function photoUrl(login: string): Promise<string | null> {
  const s = source;
  if (!s || !PHOTO_REPO_NAME || !login.trim()) return null;
  const who = login.trim().toLowerCase();
  const sha = (await photoIndex(s)).get(who);
  if (!sha) return null;
  const key = `${keyOf(s)}|${who}|${sha}`;
  const had = shown.get(key);
  if (had) return had;
  const made = readPhoto(s, who, sha).then((blob) => (blob ? URL.createObjectURL(blob) : null)).catch(() => null);
  shown.set(key, made);
  return made;
}

/** From this device if it was read before (the version is in the key), else from Door43, kept for next time. */
async function readPhoto(s: Source, login: string, sha: string): Promise<Blob | null> {
  const kept = `https://taller.local/fotos/${encodeURIComponent(s.org)}/${encodeURIComponent(login)}/${sha}`;
  const store = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  const before = store ? await store.match(kept).catch(() => undefined) : undefined;
  if (before) return before.blob();
  const answer = await fetch(`${apiBase(dcsConfig(s.session.host))}/repos/${encodeURIComponent(s.org)}/${encodeURIComponent(PHOTO_REPO_NAME)}/raw/${photoPath(login)}`, {
    headers: { Authorization: `token ${s.session.token}` },
  });
  if (!answer.ok) return null;
  const blob = await answer.blob();
  if (store) await store.put(kept, new Response(blob, { headers: { "content-type": "image/jpeg" } })).catch(() => undefined);
  return blob;
}

/**
 * The private repository, made the first time a photo is put by whoever manages the organization, and given to every
 * team of it: the teams see it, and nobody outside them.
 */
async function ensurePhotoRepo(s: Source): Promise<void> {
  const config = dcsConfig(s.session.host);
  try {
    await getRepo(config, s.org, PHOTO_REPO_NAME, s.session.token);
    return;
  } catch {
    if (!s.session.canManage) throw new Error("photo-repo-missing");
  }
  await createOrgRepo(config, s.org, {
    name: PHOTO_REPO_NAME,
    description: "Taller: fotos de las personas de los equipos (privado)",
    private: true,
    auto_init: true,
    token: s.session.token,
  });
  const teams = await listOrgTeams(config, s.org, s.session.token).catch(() => []);
  for (const team of teams) await addTeamRepo(config, team.id, s.org, PHOTO_REPO_NAME, s.session.token).catch(() => undefined);
}

function changed(): void {
  index = null;
  listeners.forEach((listen) => listen());
}

/** A person's photo put (or put again), as a JPEG already cut to its square. */
export async function savePhoto(login: string, jpegBase64: string): Promise<void> {
  const s = source;
  if (!s || !PHOTO_REPO_NAME) throw new Error("photo-no-source");
  await ensurePhotoRepo(s);
  index = null;
  const sha = (await photoIndex(s)).get(login.trim().toLowerCase());
  await createOrUpdateBinaryContents(dcsConfig(s.session.host), s.org, PHOTO_REPO_NAME, photoPath(login), {
    contentBase64: jpegBase64,
    message: `Taller: foto de @${login}`,
    ...(sha ? { sha } : {}),
    token: s.session.token,
  });
  changed();
}

/** A person's photo taken away: they are shown with their initials again. */
export async function removePhoto(login: string): Promise<void> {
  const s = source;
  if (!s || !PHOTO_REPO_NAME) return;
  index = null;
  const sha = (await photoIndex(s)).get(login.trim().toLowerCase());
  if (!sha) return;
  await deleteContents(dcsConfig(s.session.host), s.org, PHOTO_REPO_NAME, photoPath(login), { message: `Taller: se quita la foto de @${login}`, sha, token: s.session.token });
  changed();
}

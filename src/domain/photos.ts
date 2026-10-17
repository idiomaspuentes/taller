import { isCoordinatorOf } from "./levels";
import type { LevelBook } from "./levels";

/**
 * The photos of the people who work, kept in a private repository of the organization (`photoRepo`): one file per
 * person, named by their login. Door43 lets each person upload an avatar, and most never did: the team saw a list of
 * logins and wanted to see the faces of who works (Abel, 17 October).
 */
export const PHOTO_FOLDER = "avatares";
/** Side of the square a photo is kept at: sharp at the sizes shown, and a few kilobytes on a phone. */
export const PHOTO_SIZE = 256;

export const photoPath = (login: string): string => `${PHOTO_FOLDER}/${login.trim().toLowerCase()}.jpg`;

/** The login a file of the folder is the photo of; undefined for anything else in it. */
export function loginOfPhotoFile(name: string): string | undefined {
  const match = /^([^/]+)\.jpg$/i.exec(name.trim());
  return match ? match[1]!.toLowerCase() : undefined;
}

/** The square a photo is cut to: the middle of it, as wide as its shorter side (a face is rarely at an edge). */
export function centeredSquare(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.max(0, Math.min(width, height));
  return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), side };
}

/**
 * Who may put or take away the photo of a person: whoever manages the organization, for anybody; whoever coordinates
 * a team, for the people of that team.
 */
export function canSetPhoto(params: {
  me: string;
  canManage: boolean;
  levelBook: Pick<LevelBook, "coordinators"> | undefined;
  /** The teams the person is in, by name. */
  teamsOfPerson: string[];
}): boolean {
  if (params.canManage) return true;
  return params.teamsOfPerson.some((team) => isCoordinatorOf(params.levelBook, team, params.me));
}

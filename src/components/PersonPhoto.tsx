import { useEffect, useState } from "react";
import { onPhotosChanged, photoUrl } from "../dcs/photos";
import { initialsOf } from "../domain/profile";

/** The photo of a person kept by the organization, or null while there is none (or it is being read). */
export function usePersonPhoto(login: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  useEffect(() => onPhotosChanged(() => setTurn((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    if (!login) {
      setUrl(null);
      return;
    }
    void photoUrl(login).then((found) => live && setUrl(found));
    return () => {
      live = false;
    };
  }, [login, turn]);
  return url;
}

type Props = {
  login: string;
  /** Their name, for the initials when there is no photo. */
  name?: string;
  /** Their avatar in Door43, when it is known: shown when the organization has no photo of them. */
  avatarUrl?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

/**
 * A person's face: the photo the organization keeps of them (a coordinator put it), else their Door43 avatar when it
 * is known, else their initials. Beside their name it says nothing more, so it is hidden from screen readers.
 */
export function PersonPhoto({ login, name, avatarUrl, size = "md", className }: Props) {
  const kept = usePersonPhoto(login);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [avatarUrl]);
  const src = kept ?? (avatarUrl && !broken ? avatarUrl : null);
  const classes = ["person-photo", className].filter(Boolean).join(" ");
  if (src) return <img className={classes} data-size={size} src={src} alt="" aria-hidden onError={() => !kept && setBroken(true)} />;
  return (
    <span className={classes} data-size={size} data-initials aria-hidden>
      {initialsOf(name || login)}
    </span>
  );
}

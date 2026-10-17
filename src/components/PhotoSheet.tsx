import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { removePhoto, savePhoto } from "../dcs/photos";
import { explainError } from "../dcs/userError";
import { PHOTO_SIZE, centeredSquare } from "../domain/photos";
import { useT } from "../i18n/messages";
import { PersonPhoto, usePersonPhoto } from "./PersonPhoto";

/** A picture cut to the square of its middle and made small, as a JPEG: a phone's photo is megabytes. */
async function squareJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { x, y, side } = centeredSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  canvas.getContext("2d")!.drawImage(bitmap, x, y, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

type Props = {
  person: { id: string; name: string } | null;
  onClose: () => void;
  announce: (msg: string) => void;
};

/**
 * The photo of a person, put or taken away by whoever coordinates their team or manages the organization. The face
 * is touched where it is shown; the sheet says where the photo is kept and who sees it.
 */
export function PhotoSheet({ person, onClose, announce }: Props) {
  const t = useT();
  const kept = usePersonPhoto(person?.id);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setChosen(null);
    setError("");
  }, [person?.id]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      setChosen(await squareJpeg(file));
    } catch {
      setError(t("photo.unreadable"));
    }
  }

  async function run(job: () => Promise<void>, said: string) {
    if (!person) return;
    setBusy(true);
    setError("");
    try {
      await job();
      announce(said.replace("{who}", person.id));
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message === "photo-repo-missing" ? t("photo.noRepo") : explainError(err));
    } finally {
      setBusy(false);
    }
  }

  const name = person?.name || person?.id || "";
  return (
    <Dialog open={Boolean(person)} onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="fix-sheet photo-sheet" aria-label={t("photo.title").replace("{name}", name)}>
        <header className="fx-head">
          <DialogTitle className="fx-title">{t("photo.title").replace("{name}", name)}</DialogTitle>
          {person ? <p className="ws-meta">@{person.id}</p> : null}
        </header>
        <div className="fx-body photo-sheet__body">
          {chosen ? <img className="person-photo" data-size="lg" src={chosen} alt="" aria-hidden /> : person ? <PersonPhoto login={person.id} name={name} size="lg" /> : null}
          <p className="af-hint">{t("photo.consent")}</p>
          {error ? (
            <p className="ws-error" role="alert">
              {error}
            </p>
          ) : null}
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
        <footer className="fx-foot photo-sheet__foot">
          {chosen ? (
            <>
              <Button type="button" disabled={busy} onClick={() => void run(() => savePhoto(person!.id, chosen.split(",")[1]!), t("photo.saved"))}>
                {busy ? t("photo.saving") : t("photo.save")}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
                {t("photo.chooseOther")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" disabled={busy} onClick={() => input.current?.click()}>
                {t(kept ? "photo.change" : "photo.choose")}
              </Button>
              {kept ? (
                <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => removePhoto(person!.id), t("photo.removed"))}>
                  {t("photo.remove")}
                </Button>
              ) : null}
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

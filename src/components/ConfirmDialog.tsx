import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "../i18n/messages";

/**
 * A question before something that cannot be undone from here (delivering, giving the task back, handing in work
 * that is not finished). It is asked apart from the button that was pressed: an answer under the same finger is
 * given by pressing twice, without having read the question.
 */
export function ConfirmDialog({
  open,
  title,
  text,
  yes,
  no,
  safe,
  onYes,
  onNo,
  onDismiss,
}: {
  open: boolean;
  title: string;
  text: string;
  yes: string;
  /** What the way back is called here; «No, volver» when it has no name of its own. */
  no?: string;
  /** The way back is what most people want: it is the one that stands out, and going on is the other. */
  safe?: boolean;
  onYes: () => void;
  onNo: () => void;
  /** Closed without an answer. The same as the way back, unless that does something more than close. */
  onDismiss?: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && (onDismiss ?? onNo)()}>
      <DialogContent className="sm:max-w-sm dialog--confirm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {safe ? (
            <>
              <Button type="button" variant="outline" size="lg" onClick={onYes}>
                {yes}
              </Button>
              <Button type="button" size="lg" onClick={onNo}>
                {no ?? t("tb.cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" size="lg" onClick={onNo}>
                {no ?? t("tb.cancel")}
              </Button>
              <Button type="button" size="lg" onClick={onYes}>
                {yes}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

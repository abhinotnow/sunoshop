import { useEffect, useRef } from "react";
import { t } from "../i18n/ui";
import type { Dialog } from "../hooks/useOriel";
import type { Lang } from "../types";

/** Yes/no question. Answer by voice ("yes"/"no"), head nod/shake, Y/N keys, or the big buttons. */
export function DialogCard({ dialog, lang }: { dialog: Dialog | null; lang: Lang }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (dialog) yes.current?.focus();
  }, [dialog]);
  if (!dialog) return null;
  return (
    <div className="sheet-backdrop center">
      <div className="dialog glass" role="alertdialog" aria-modal="true" aria-labelledby="dlg-text">
        <p id="dlg-text" className="dialog-text" lang={lang}>{dialog.text}</p>
        <div className="dialog-actions">
          <button ref={yes} className="btn big yes" onClick={dialog.onYes}>{t("yes", lang)}</button>
          <button className="btn big no" onClick={dialog.onNo}>{t("no", lang)}</button>
        </div>
      </div>
    </div>
  );
}

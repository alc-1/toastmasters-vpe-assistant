// src/shared/modal.ts
//
// The ONE modal in this extension — an intentional, documented exception to
// the otherwise-strict "no modal / no toast, use inline status lines"
// convention (see CLAUDE.md "Conventions"). It exists only for a genuinely
// destructive, irreversible action: "Load Backup File" on the Home dashboard
// wipes and replaces the whole storage.local area, which warrants a blocking
// confirm rather than an inline two-step. Don't reach for this for ordinary
// confirmations — those stay inline.
//
// Built on a native <dialog> + showModal() (daisyUI `modal` / `modal-box`
// styling): the browser gives us the focus trap, the top-layer stacking, the
// ::backdrop and Esc-to-cancel for free — no hand-rolled keydown/focus code.
// No browser.* dependency (plain DOM), and self-cleaning: the <dialog> and its
// listeners are removed the moment the returned promise settles, so a caller
// doesn't need to thread it through a view's dispose lifecycle.

import { escapeHtml } from "./dom-utils";

export interface ConfirmModalOptions {
  title: string;
  /** Plain text (escaped) — a short paragraph. */
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for a destructive action. */
  danger?: boolean;
  /** Aborting resolves the promise with `false` and tears the dialog down —
   *  e.g. the calling view was navigated away from while the modal was open. */
  signal?: AbortSignal;
}

/**
 * Shows a modal confirm dialog. Resolves `true` if the user confirms, `false`
 * on cancel / Esc / backdrop click.
 */
export function confirmModal(opts: ConfirmModalOptions): Promise<boolean> {
  const { title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, signal } = opts;

  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.innerHTML = `
      <div class="modal-box">
        <h2 class="modal__title">${escapeHtml(title)}</h2>
        <p class="modal__body">${escapeHtml(body)}</p>
        <div class="modal__actions">
          <button type="button" class="btn btn-secondary" data-modal-action="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? "btn-error" : "btn-primary"}" data-modal-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button type="submit" tabindex="-1" aria-label="Close">close</button></form>
    `;

    let settled = false;
    function close(result: boolean) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      dialog.close();
      dialog.remove();
      resolve(result);
    }

    function onAbort() {
      close(false);
    }

    // Esc fires `cancel` on a <dialog>; the <form method="dialog"> backdrop
    // fires `close` when clicked. Both routes resolve `false`.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close(false);
    });
    dialog.addEventListener("close", () => close(false));
    dialog.querySelector('[data-modal-action="cancel"]')!.addEventListener("click", () => close(false));
    dialog.querySelector('[data-modal-action="confirm"]')!.addEventListener("click", () => close(true));

    signal?.addEventListener("abort", onAbort);
    document.body.appendChild(dialog);

    // daisyUI animates the modal in via @starting-style; that transition gets
    // stuck at opacity:0 if showModal() runs in the same frame as the append
    // (no "before-open" style is ever computed). One painted frame without
    // [open] first, then open.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (settled) return;
        dialog.showModal();
        dialog.querySelector<HTMLButtonElement>('[data-modal-action="confirm"]')!.focus();
      });
    });
  });
}

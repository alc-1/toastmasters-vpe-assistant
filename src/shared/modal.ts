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
// No browser.* dependency (plain DOM), and self-cleaning: the overlay and its
// keydown listener are removed the moment the returned promise settles, so a
// caller doesn't need to thread it through a view's dispose lifecycle.

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
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <h2 class="modal__title" id="modalTitle">${escapeHtml(title)}</h2>
        <p class="modal__body">${escapeHtml(body)}</p>
        <div class="modal__actions">
          <button type="button" class="btn btn-secondary" data-modal-action="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? "btn-error" : "btn-primary"}" data-modal-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    function close(result: boolean) {
      document.removeEventListener("keydown", onKeydown);
      signal?.removeEventListener("abort", onAbort);
      overlay.remove();
      resolve(result);
    }

    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
    }

    function onAbort() {
      close(false);
    }

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(false);
    });
    overlay.querySelector('[data-modal-action="cancel"]')!.addEventListener("click", () => close(false));
    overlay.querySelector('[data-modal-action="confirm"]')!.addEventListener("click", () => close(true));

    document.addEventListener("keydown", onKeydown);
    signal?.addEventListener("abort", onAbort);
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLButtonElement>('[data-modal-action="confirm"]')!.focus();
  });
}

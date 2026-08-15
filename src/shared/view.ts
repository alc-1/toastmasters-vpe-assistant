// src/shared/view.ts
//
// The contract every entrypoints/app/views/*.ts module implements. The app
// shell (entrypoints/app/main.ts) guarantees only one view's markup exists
// in the live DOM at a time — dispose the outgoing view, clear #viewRoot,
// mount the incoming one, strictly in that order (see router.ts's
// navigate()) — so a view's mount() is free to use plain
// document.getElementById() lookups exactly like the old, page-per-view
// code did: the previous view's same-named elements are provably gone
// before mount() runs. Do not weaken this ordering invariant without
// re-checking every view for stale-element assumptions.

export interface ViewModule {
  /**
   * Mounts this view's markup + behavior into `root` (already emptied by
   * the shell). All DOM binding, event-listener registration, and
   * per-visit state must happen here — not at module top level — since
   * root's previous contents (a different view, or an earlier visit to
   * this same one) no longer exist by the time this runs.
   *
   * Returns a disposer the shell calls before clearing root for the next
   * navigation — it must remove every listener this mount registered
   * outside of `root` itself (a `document`/`window`-level listener, most
   * notably) since those do NOT get cleaned up for free by clearing
   * root's innerHTML.
   */
  mount(root: HTMLElement): Promise<() => void>;
}

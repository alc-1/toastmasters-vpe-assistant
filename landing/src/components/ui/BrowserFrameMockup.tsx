import type { ReactNode } from "react";

interface Props {
  urlLabel?: string;
  children: ReactNode;
  className?: string;
}

/** Chrome-style browser frame used to wrap placeholder dashboard art / future real screenshots. */
export default function BrowserFrameMockup({
  urlLabel = "extension: Toastmasters VPE Assistant",
  children,
  className = "",
}: Props) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-silver-light bg-white shadow-2xl shadow-navy-900/20 ${className}`}
    >
      <div className="flex items-center gap-3 border-b border-silver-light bg-surface-alt px-4 py-3">
        <span className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-danger/70" />
          <span className="h-3 w-3 rounded-full bg-warning/70" />
          <span className="h-3 w-3 rounded-full bg-success/70" />
        </span>
        <span className="flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-navy-700/70 border border-silver-light">
          {urlLabel}
        </span>
      </div>
      <div className="bg-white">{children}</div>
    </div>
  );
}

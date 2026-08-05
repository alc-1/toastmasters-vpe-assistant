import { useState } from "react";
import type { ReactNode } from "react";

interface Props {
  question: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export default function Accordion({ question, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-silver-light">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-semibold text-navy-950 hover:text-navy-700 transition-colors"
      >
        <span>{question}</span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-xl leading-none text-navy-700 transition-transform duration-200 ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
      </button>
      {open && <div className="pb-5 text-navy-700/90 leading-relaxed">{children}</div>}
    </div>
  );
}

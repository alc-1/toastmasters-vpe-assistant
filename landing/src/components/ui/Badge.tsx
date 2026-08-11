import type { ReactNode } from "react";

type Tone = "navy" | "success" | "warning";

const toneClasses: Record<Tone, string> = {
  navy: "bg-navy-50 text-navy-700",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning-text",
};

interface Props {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

export default function Badge({ tone = "navy", children, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

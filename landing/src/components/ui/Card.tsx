import type { ReactNode } from "react";

type Variant = "default" | "highlighted";

const variantClasses: Record<Variant, string> = {
  default: "border-silver-light bg-white",
  highlighted: "border-navy-700 bg-white shadow-md shadow-navy-900/5",
};

interface Props {
  variant?: Variant;
  className?: string;
  children: ReactNode;
}

export default function Card({ variant = "default", className = "", children }: Props) {
  return (
    <div className={`rounded-xl border p-6 ${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  );
}

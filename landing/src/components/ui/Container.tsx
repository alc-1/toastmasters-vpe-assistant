import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
}

export default function Container({ children, narrow = false, className = "" }: Props) {
  const width = narrow ? "max-w-3xl" : "max-w-7xl";
  return <div className={`mx-auto ${width} px-6 sm:px-8 ${className}`}>{children}</div>;
}

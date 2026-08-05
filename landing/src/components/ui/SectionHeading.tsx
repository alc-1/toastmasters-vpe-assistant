import type { ReactNode } from "react";

interface Props {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "left" | "center";
  tone?: "dark" | "light";
  className?: string;
}

export default function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  tone = "dark",
  className = "",
}: Props) {
  const alignClasses = align === "center" ? "text-center items-center mx-auto" : "text-left items-start";
  const eyebrowColor = tone === "dark" ? "text-navy-700" : "text-yellow-accent";
  const titleColor = tone === "dark" ? "text-navy-950" : "text-white";
  const subtitleColor = tone === "dark" ? "text-navy-700/80" : "text-navy-100";

  return (
    <div className={`flex flex-col gap-4 ${alignClasses} max-w-2xl ${className}`}>
      {eyebrow && (
        <span className={`text-sm font-semibold uppercase tracking-wide ${eyebrowColor}`}>
          {eyebrow}
        </span>
      )}
      <h2 className={`text-3xl sm:text-4xl font-bold tracking-tight ${titleColor}`}>{title}</h2>
      {subtitle && <p className={`text-lg leading-relaxed ${subtitleColor}`}>{subtitle}</p>}
    </div>
  );
}

import type { ReactNode } from "react";
import Container from "./Container";

type Tone = "white" | "alt" | "navy";

const toneClasses: Record<Tone, string> = {
  white: "bg-white",
  alt: "bg-surface-alt",
  navy: "bg-navy-900 text-white",
};

interface Props {
  id?: string;
  tone?: Tone;
  narrow?: boolean;
  className?: string;
  children: ReactNode;
}

export default function Section({ id, tone = "white", narrow = false, className = "", children }: Props) {
  return (
    <section id={id} className={`${toneClasses[tone]} py-20 sm:py-28 scroll-mt-20 ${className}`}>
      <Container narrow={narrow}>{children}</Container>
    </section>
  );
}

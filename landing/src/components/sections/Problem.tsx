import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

const workflowSteps = [
  "Open Basecamp",
  "Open EasySpeak",
  "Open Club Central",
  "Check members individually",
  "Compare records manually",
  "Figure out differences",
];

export default function Problem() {
  return (
    <Section id="problem" tone="alt">
      <SectionHeading
        eyebrow="The Problem"
        title="The Process Every VPE Knows Too Well"
        subtitle="Basecamp, EasySpeak, and Club Central each hold part of the picture, but none of them talk to each other. Every report means doing the cross-checking yourself."
      />

      <div className="mt-12 flex flex-col sm:flex-row sm:flex-wrap items-center sm:items-stretch justify-center gap-3">
        {workflowSteps.map((step, i) => (
          <div key={step} className="flex flex-col sm:flex-row items-center gap-3">
            <div className="rounded-[var(--radius-md)] border border-silver-light bg-white px-5 py-4 text-sm font-medium text-navy-950 shadow-sm">
              {step}
            </div>
            {i < workflowSteps.length - 1 && (
              <span aria-hidden="true" className="text-navy-700/40 text-xl rotate-90 sm:rotate-0">
                &rarr;
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-navy-700/80 max-w-2xl mx-auto leading-relaxed">
        It's slow, it's repetitive, and it's easy to miss a mismatch buried in dozens of member
        records — especially when you're doing it club by club, member by member, every time you
        need an up-to-date picture.
      </p>
    </Section>
  );
}

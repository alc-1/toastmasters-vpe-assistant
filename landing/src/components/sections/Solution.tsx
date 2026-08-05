import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

const highlights = [
  "No spreadsheets",
  "No manual exports",
  "No copy/paste work",
  "No repeated reconciliation",
];

export default function Solution() {
  return (
    <Section id="solution" tone="white">
      <SectionHeading
        eyebrow="The Solution"
        title="One Unified View of Club Progress"
        subtitle="The extension pulls data from both systems, matches members, clubs, and paths, and gives you a single dashboard — instead of two browser tabs and a mental cross-reference."
      />

      <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {highlights.map((item) => (
          <div
            key={item}
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-silver-light bg-surface-alt px-4 py-3 text-sm font-medium text-navy-950"
          >
            <span aria-hidden="true" className="text-success">
              &#10003;
            </span>
            {item}
          </div>
        ))}
      </div>
    </Section>
  );
}

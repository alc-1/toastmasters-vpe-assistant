import { workflowSteps } from "../../data/workflowSteps";
import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

export default function Workflow() {
  return (
    <Section tone="white">
      <SectionHeading
        eyebrow="How It Works"
        title="From Manual Investigation to Two-Click Reporting"
      />

      <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        {workflowSteps.map((item) => (
          <div key={item.step} className="flex flex-col gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-700 text-white font-semibold">
              {item.step}
            </div>
            <h3 className="text-base font-semibold text-navy-950">{item.title}</h3>
            <p className="text-sm text-navy-700/80 leading-relaxed">{item.description}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

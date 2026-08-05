import { benefits } from "../../data/benefits";
import Section from "../ui/Section";

export default function BenefitsGrid() {
  return (
    <Section tone="alt">
      <div className="grid sm:grid-cols-2 gap-6">
        {benefits.map((benefit) => (
          <div
            key={benefit.title}
            className="rounded-xl border border-silver-light bg-white p-6 shadow-sm"
          >
            <h3 className="text-lg font-semibold text-navy-950">{benefit.title}</h3>
            <p className="mt-2 text-navy-700/80 leading-relaxed">{benefit.description}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

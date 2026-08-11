import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

export default function BuiltByToastmaster() {
  return (
    <Section id="built-by-a-toastmaster" tone="alt" narrow>
      <SectionHeading title="Built by a Toastmaster" />

      <div className="mt-8 flex flex-col gap-4 text-navy-700/90 leading-relaxed text-lg">
        <p>
          Hi! I'm Alvaro, a Toastmaster and developer. When I became VPE at Lausanne International
          Toastmasters Club, I didn't want to spend hours manually aggregating Pathways data for
          60 members.
        </p>
        <p>So I built the tool I wished I had.</p>
        <p>Now I'd like VPEs from other clubs to tell me whether it actually solves their problem.</p>
      </div>
    </Section>
  );
}

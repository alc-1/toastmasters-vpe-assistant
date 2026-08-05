import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

const points = [
  "Uses your existing browser sessions",
  "No additional passwords",
  "Data processed locally when possible",
  "No spreadsheet maintenance",
  "Human review for uncertain matches",
];

export default function TrustPrivacy() {
  return (
    <Section tone="navy">
      <SectionHeading
        tone="light"
        eyebrow="Trust & Privacy"
        title="Designed for Toastmasters Officers"
        subtitle="Built around how VPEs actually work — with the access they already have, not a new account to manage."
      />

      <ul className="mt-10 grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
        {points.map((point) => (
          <li key={point} className="flex items-center gap-3 text-navy-50">
            <span aria-hidden="true" className="text-yellow-accent">
              &#10003;
            </span>
            {point}
          </li>
        ))}
      </ul>
    </Section>
  );
}

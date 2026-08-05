import { faqItems } from "../../data/faq";
import Accordion from "../ui/Accordion";
import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

export default function FAQ() {
  return (
    <Section id="faq" tone="alt" narrow>
      <SectionHeading title="Frequently Asked Questions" />

      <div className="mt-10">
        {faqItems.map((item) => (
          <Accordion key={item.question} question={item.question}>
            {item.answer}
          </Accordion>
        ))}
      </div>
    </Section>
  );
}

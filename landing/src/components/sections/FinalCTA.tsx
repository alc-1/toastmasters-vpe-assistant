import { getStoreSelection, FEEDBACK_URL } from "../../data/releaseInfo";
import AlsoAvailableLinks from "../ui/AlsoAvailableLinks";
import Button from "../ui/Button";
import Section from "../ui/Section";

export default function FinalCTA() {
  const { main, others } = getStoreSelection();

  return (
    <Section tone="navy" narrow>
      <div className="text-center flex flex-col items-center gap-6">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Spend Less Time Reconciling Records. Spend More Time Helping Members Grow.
        </h2>
        <p className="text-navy-100">Ready to try it?</p>
        <p className="text-navy-200 max-w-xl">
          Install the extension for your browser, or help shape what's next with your feedback.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="primary" href={main.url} target="_blank" rel="noopener noreferrer">
            Add to {main.name}
          </Button>
          <Button variant="ghost" href={FEEDBACK_URL}>
            Help Shape the Tool
          </Button>
        </div>
        <AlsoAvailableLinks stores={others} className="text-sm text-navy-300" />
      </div>
    </Section>
  );
}

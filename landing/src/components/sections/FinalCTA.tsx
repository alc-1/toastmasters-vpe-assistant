import { scrollToId } from "../../lib/scrollToId";
import Button from "../ui/Button";
import Section from "../ui/Section";

export default function FinalCTA() {
  return (
    <Section tone="navy" narrow>
      <div className="text-center flex flex-col items-center gap-6">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Spend Less Time Reconciling Records. Spend More Time Helping Members Grow.
        </h2>
        <Button variant="primary" onClick={() => scrollToId("get-started")}>
          Become an Early Tester
        </Button>
      </div>
    </Section>
  );
}

import { CHROME_WEB_STORE_URL, PREVIEW_SIGNUP_URL } from "../../data/releaseInfo";
import Button from "../ui/Button";
import Section from "../ui/Section";

export default function FinalCTA() {
  return (
    <Section tone="navy" narrow>
      <div className="text-center flex flex-col items-center gap-6">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Spend Less Time Reconciling Records. Spend More Time Helping Members Grow.
        </h2>
        <p className="text-navy-100">Ready to try it?</p>
        <p className="text-navy-200 max-w-xl">
          Install the stable version from the Chrome Web Store, or help shape what's next through
          the Preview Program.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="primary"
            href={CHROME_WEB_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Install Stable Version
          </Button>
          <Button variant="ghost" href={PREVIEW_SIGNUP_URL}>
            Join Preview Program
          </Button>
        </div>
      </div>
    </Section>
  );
}

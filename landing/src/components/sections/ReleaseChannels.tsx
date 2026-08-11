import { CHROME_WEB_STORE_URL, PREVIEW_SIGNUP_URL } from "../../data/releaseInfo";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

const stableBullets = [
  "Available on the Chrome Web Store",
  "Reviewed before publication",
  "Recommended for everyday use",
  "Updated through Chrome",
];

const previewBullets = [
  "Get the latest builds before Chrome Web Store publication",
  "Try new features earlier",
  "Give direct feedback",
  "Influence the product roadmap",
];

export default function ReleaseChannels() {
  return (
    <Section id="release-channels" tone="white">
      <SectionHeading title="Choose Your Release Channel" />

      <div className="mt-14 grid sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
        <Card className="flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="success">Recommended</Badge>
            <Badge tone="navy">Chrome Web Store</Badge>
          </div>
          <h3 className="text-xl font-semibold text-navy-950">Stable</h3>
          <p className="text-navy-700/80">For VPEs who just want to get things done.</p>
          <ul className="flex flex-col gap-2 text-sm text-navy-700/90">
            {stableBullets.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-success mt-0.5">
                  &#10003;
                </span>
                {item}
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            href={CHROME_WEB_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-auto"
          >
            Install Stable Version
          </Button>
        </Card>

        <Card variant="highlighted" className="flex flex-col gap-4">
          <Badge tone="warning">Early Access</Badge>
          <h3 className="text-xl font-semibold text-navy-950">Preview</h3>
          <p className="text-navy-700/80">For VPEs who want to help shape the product.</p>
          <ul className="flex flex-col gap-2 text-sm text-navy-700/90">
            {previewBullets.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-success mt-0.5">
                  &#10003;
                </span>
                {item}
              </li>
            ))}
          </ul>
          <Button variant="secondary" href={PREVIEW_SIGNUP_URL} className="mt-auto">
            Become a Preview Tester
          </Button>
          <p className="text-xs text-navy-700/70">
            Preview builds may be ahead of the Chrome Web Store version and may occasionally
            contain bugs or incomplete features.
          </p>
        </Card>
      </div>
    </Section>
  );
}

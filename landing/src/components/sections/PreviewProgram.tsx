import { ISSUES_URL, RELEASES_URL } from "../../data/installSteps";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

const whatYouGet = [
  "Latest builds before Chrome Web Store release",
  "New features earlier",
  "Direct feedback channel with the developer",
  "Influence over the roadmap",
];

const whatIAsk = [
  "Use it with your club",
  "Tell me when something is confusing",
  "Report bugs and suggest improvements",
  "Tell me which information and reports are most useful",
];

export default function PreviewProgram() {
  return (
    <Section id="preview-program" tone="alt">
      <SectionHeading
        title="Become a Preview Tester"
        subtitle="I'm looking for Toastmasters VPEs who want to use the latest versions of the extension with their real club data and help shape what gets built next."
      />

      <div className="mt-10 grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <Card>
          <h3 className="text-base font-semibold text-navy-950">What you get</h3>
          <ul className="mt-4 space-y-3 text-sm text-navy-700/90 leading-relaxed">
            {whatYouGet.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-success mt-0.5">
                  &#10003;
                </span>
                {item}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-navy-950">What I ask from you</h3>
          <ul className="mt-4 space-y-3 text-sm text-navy-700/90 leading-relaxed">
            {whatIAsk.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-navy-700 mt-0.5">
                  &#10003;
                </span>
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-16 max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 rounded-xl border border-silver-light bg-white px-6 py-6">
        <div>
          <h3 className="text-base font-semibold text-navy-950">Join the Preview Program</h3>
          <p className="text-sm text-navy-700/80 mt-1">
            Download the latest release, then come back and{" "}
            <a
              href={ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-navy-700 underline hover:text-navy-950"
            >
              open an issue
            </a>{" "}
            with bugs or feature ideas — that feedback is what shapes the roadmap.
          </p>
        </div>
        <Button
          variant="primary"
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0"
        >
          Download the latest release
        </Button>
      </div>
    </Section>
  );
}

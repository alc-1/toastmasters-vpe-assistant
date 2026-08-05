import { ISSUES_URL, RELEASES_URL, installSteps, requirements } from "../../data/installSteps";
import Button from "../ui/Button";
import CopyButton from "../ui/CopyButton";
import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

const betaBenefits = [
  "Benefit from automation today",
  "Direct influence on roadmap",
  "Early access to new features",
  "Direct communication with the developer",
];

export default function GetStarted() {
  return (
    <Section id="get-started" tone="white">
      <SectionHeading
        eyebrow="Join the Beta"
        title="Help Shape the First VPE Assistant Built for Pathways Tracking"
        subtitle="We're looking for Toastmasters Vice Presidents of Education who regularly manage Pathways progress and want to eliminate manual cross-checking between Basecamp and EasySpeak."
      />

      <div className="mt-10 grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
        {betaBenefits.map((item) => (
          <div
            key={item}
            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-silver-light bg-surface-alt px-4 py-3 text-sm font-medium text-navy-950"
          >
            <span aria-hidden="true" className="text-success">
              &#10003;
            </span>
            {item}
          </div>
        ))}
      </div>

      <div className="mt-16 max-w-3xl mx-auto">
        <div className="grid sm:grid-cols-2 gap-10">
          <div>
            <h3 className="text-lg font-semibold text-navy-950">Requirements</h3>
            <ul className="mt-4 space-y-3 text-sm text-navy-700/90 leading-relaxed list-disc pl-5">
              {requirements.map((req) => (
                <li key={req}>{req}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-navy-950">Install</h3>
            <p className="mt-2 text-sm text-navy-700/80">
              Not on the Chrome Web Store yet — install it manually from the latest release.
            </p>
            <ol className="mt-4 space-y-4">
              {installSteps.map((step) => (
                <li key={step.step} className="flex gap-3 text-sm text-navy-700/90 leading-relaxed">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white">
                    {step.step}
                  </span>
                  <span>
                    {step.step === 2 ? (
                      <>
                        Open <CopyButton text="chrome://extensions" /> — Chrome doesn't allow web
                        pages to link there directly, so copy the address and paste it into the
                        address bar.
                      </>
                    ) : (
                      step.description
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-6 rounded-xl border border-silver-light bg-surface-alt px-6 py-6">
          <div>
            <h3 className="text-base font-semibold text-navy-950">Ready to try it?</h3>
            <p className="text-sm text-navy-700/80 mt-1">
              Download the latest release, then come back and{" "}
              <a href={ISSUES_URL} className="text-navy-700 underline hover:text-navy-950">
                open an issue
              </a>{" "}
              with bugs or feature ideas — that feedback is what shapes the roadmap.
            </p>
          </div>
          <Button variant="primary" href={RELEASES_URL} className="shrink-0">
            Download the latest release
          </Button>
        </div>
      </div>
    </Section>
  );
}

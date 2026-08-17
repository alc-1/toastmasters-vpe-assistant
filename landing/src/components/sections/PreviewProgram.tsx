import type { ReactNode, SVGProps } from "react";
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

function ClubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="7" cy="7" r="2.5" />
      <circle cx="14" cy="8.5" r="2" />
      <path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" strokeLinecap="round" />
      <path d="M12.5 12.6c1.9.2 3.5 1.5 3.5 3.4" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path
        d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v6A1.5 1.5 0 0 1 15.5 13H8l-3.5 3v-3H4.5A1.5 1.5 0 0 1 3 11.5v-6Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BugIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <rect x="7" y="6" width="6" height="8" rx="3" />
      <path
        d="M10 6V4M7.3 8H3.5M7.3 10H3M7.3 12H3.5M12.7 8H16.5M12.7 10H17M12.7 12H16.5M8.2 4.6 6.8 3.3M11.8 4.6 13.2 3.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M3 16.5h14" strokeLinecap="round" />
      <path d="M5.5 16.5v-5M10 16.5v-8M14.5 16.5v-3" strokeLinecap="round" />
    </svg>
  );
}

const whatIAsk: { text: string; Icon: (props: SVGProps<SVGSVGElement>) => ReactNode }[] = [
  { text: "Use it with your club", Icon: ClubIcon },
  { text: "Tell me when something is confusing", Icon: ChatIcon },
  { text: "Report bugs and suggest improvements", Icon: BugIcon },
  { text: "Share which reports add the most value", Icon: ChartIcon },
];

const previewSteps: { step: number; title: string; description: ReactNode }[] = [
  {
    step: 1,
    title: "Install the release",
    description: "Download the latest preview build using the button below.",
  },
  {
    step: 2,
    title: "Use it with your club",
    description: "Run it against your real club data for a few weeks.",
  },
  {
    step: 3,
    title: "Open an issue with feedback",
    description: (
      <>
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-navy-700 underline hover:text-navy-950"
        >
          Open an issue
        </a>{" "}
        with bugs or ideas — that's what shapes the roadmap.
      </>
    ),
  },
];

export default function PreviewProgram() {
  return (
    <Section id="preview-program" tone="white">
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
            {whatIAsk.map(({ text, Icon }) => (
              <li key={text} className="flex items-start gap-2">
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 mt-0.5 text-navy-700" />
                {text}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-16 max-w-3xl mx-auto rounded-xl border border-silver-light bg-white px-6 py-8 sm:px-10 sm:py-10">
        <h3 className="text-lg font-semibold text-navy-950 text-center">
          Join the Preview Program
        </h3>

        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {previewSteps.map((item) => (
            <div key={item.step} className="flex flex-col gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-700 text-white font-semibold">
                {item.step}
              </div>
              <h4 className="text-sm font-semibold text-navy-950">{item.title}</h4>
              <p className="text-sm text-navy-700/80 leading-relaxed">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <Button
            variant="primary"
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 text-base"
          >
            Download the latest release
          </Button>
        </div>
      </div>
    </Section>
  );
}

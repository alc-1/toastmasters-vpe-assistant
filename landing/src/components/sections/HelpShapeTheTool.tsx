import type { ReactNode, SVGProps } from "react";
import { ISSUES_URL } from "../../data/installSteps";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

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

const howYouCanHelp: {
  lead: string;
  text: string;
  Icon: (props: SVGProps<SVGSVGElement>) => ReactNode;
}[] = [
  {
    lead: "Share your pain points:",
    text: "Tell me which routine VPE tasks still take up too much time.",
    Icon: ChatIcon,
  },
  {
    lead: "Suggest new features:",
    text: "Have an idea for a report or visualization? Let me know.",
    Icon: ChartIcon,
  },
  {
    lead: "Report issues:",
    text: "Notice a mismatched record or data glitch? Drop a quick note so it can be fixed.",
    Icon: BugIcon,
  },
  {
    lead: "Guide the direction:",
    text: "Share which features bring the most value to your club.",
    Icon: ClubIcon,
  },
];

const whatHappensToFeedback: { lead: string; text: string }[] = [
  {
    lead: "User-Driven Roadmap:",
    text: "Ideas and feature requests from real VPEs go straight to the top of the queue.",
  },
  {
    lead: "Direct Access:",
    text: "Communicate directly with the developer—no corporate support tickets.",
  },
  {
    lead: "Continuous Improvement:",
    text: "The extension is actively maintained and updated regularly based on community input.",
  },
];

const involvementSteps: { step: number; title: string; description: ReactNode }[] = [
  {
    step: 1,
    title: "Use the Extension",
    description: "Run it during your weekly VPE routines.",
  },
  {
    step: 2,
    title: "Share Your Ideas",
    description: (
      <>
        Found a bug or have a feature request?{" "}
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-navy-700 underline hover:text-navy-950"
        >
          Open an issue on GitHub
        </a>
        .
      </>
    ),
  },
  {
    step: 3,
    title: "Watch It Evolve",
    description: "Your input directly influences future updates.",
  },
];

export default function HelpShapeTheTool() {
  return (
    <Section id="feedback" tone="white">
      <SectionHeading
        title="Help Shape the Tool"
        subtitle="Toastmasters VPE Assistant is built for VPEs, by a VPE. Your real-world experience directly guides what gets built next."
      />

      <div className="mt-10 grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <Card>
          <h3 className="text-base font-semibold text-navy-950">How You Can Help</h3>
          <ul className="mt-4 space-y-3 text-sm text-navy-700/90 leading-relaxed">
            {howYouCanHelp.map(({ lead, text, Icon }) => (
              <li key={lead} className="flex items-start gap-2">
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 mt-0.5 text-navy-700" />
                <span>
                  <span className="font-semibold text-navy-950">{lead}</span> {text}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-navy-950">What Happens to Your Feedback</h3>
          <ul className="mt-4 space-y-3 text-sm text-navy-700/90 leading-relaxed">
            {whatHappensToFeedback.map(({ lead, text }) => (
              <li key={lead} className="flex items-start gap-2">
                <span aria-hidden="true" className="text-success mt-0.5">
                  &#10003;
                </span>
                <span>
                  <span className="font-semibold text-navy-950">{lead}</span> {text}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-16 max-w-3xl mx-auto rounded-xl border border-silver-light bg-white px-6 py-8 sm:px-10 sm:py-10">
        <h3 className="text-lg font-semibold text-navy-950 text-center">
          How Your Input Shapes the Tool
        </h3>

        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {involvementSteps.map((item) => (
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
            href={ISSUES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 text-base"
          >
            Share Feedback or Request a Feature
          </Button>
        </div>
      </div>
    </Section>
  );
}

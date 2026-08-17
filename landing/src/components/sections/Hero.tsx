import dashboardScreenshot from "../../assets/screenshot_club_progress.png";
import { getStoreSelection } from "../../data/releaseInfo";
import AlsoAvailableLinks from "../ui/AlsoAvailableLinks";
import Button from "../ui/Button";
import BrowserFrameMockup from "../ui/BrowserFrameMockup";
import Container from "../ui/Container";
import Lightbox, { useLightbox } from "../ui/Lightbox";

const dashboardAlt =
  "Toastmasters VPE Assistant Club Progress dashboard, showing member counts, paths, and a Next Level Summary table";

const trustSignals = [
  "Built for Toastmasters VPEs",
  "No additional credentials required",
];

export default function Hero() {
  const lightbox = useLightbox();
  const { main, others } = getStoreSelection();

  return (
    <section id="top" className="bg-navy-950 pt-16 pb-20 sm:pt-24 sm:pb-28">
      <Container>
        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <div className="flex flex-col gap-6 text-center lg:text-left items-center lg:items-start">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
              Stop Cross-Checking Basecamp and EasySpeak
            </h1>
            <p className="text-lg text-navy-100 max-w-xl leading-relaxed">
              Get a complete view of your club's Pathways progress in minutes instead of hours.
            </p>
            <div className="flex flex-col gap-3 mt-2 items-center lg:items-start">
              <Button variant="primary" href={main.url} target="_blank" rel="noopener noreferrer">
                Add to {main.name}
              </Button>
              <AlsoAvailableLinks stores={others} className="text-sm text-navy-300" />
            </div>
            <ul className="flex flex-wrap justify-center lg:justify-start gap-x-5 gap-y-1 text-sm text-navy-300 mt-2">
              {trustSignals.map((signal) => (
                <li key={signal} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="text-yellow-accent">
                    &#10003;
                  </span>
                  {signal}
                </li>
              ))}
            </ul>
          </div>

          <BrowserFrameMockup urlLabel="Toastmasters VPE Assistant — Club Progress">
            <button
              type="button"
              onClick={() => lightbox.open({ src: dashboardScreenshot, alt: dashboardAlt })}
              aria-label="View larger screenshot: Club Progress dashboard"
              className="group relative block w-full cursor-zoom-in"
            >
              <img src={dashboardScreenshot} alt={dashboardAlt} className="block w-full h-auto" />
              <span className="absolute inset-0 flex items-center justify-center bg-navy-950/0 group-hover:bg-navy-950/40 transition-colors">
                <span className="rounded-full bg-navy-950/70 px-3 py-1.5 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                  Click to enlarge
                </span>
              </span>
            </button>
          </BrowserFrameMockup>
        </div>
      </Container>

      <Lightbox image={lightbox.image} onClose={lightbox.close} />
    </section>
  );
}

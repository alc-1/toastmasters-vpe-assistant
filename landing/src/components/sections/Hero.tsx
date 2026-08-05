import dashboardScreenshot from "../../assets/screenshot_club_progress.png";
import { scrollToId } from "../../lib/scrollToId";
import Button from "../ui/Button";
import BrowserFrameMockup from "../ui/BrowserFrameMockup";
import Container from "../ui/Container";
import Lightbox, { useLightbox } from "../ui/Lightbox";

const dashboardAlt =
  "Toastmasters VPE Assistant Club Progress dashboard, showing member counts, paths, and a Next Level Summary table";

export default function Hero() {
  const lightbox = useLightbox();

  return (
    <section id="top" className="bg-navy-950 pt-16 pb-20 sm:pt-24 sm:pb-28">
      <Container>
        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <div className="flex flex-col gap-6 text-center lg:text-left items-center lg:items-start">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
              Stop Cross-Checking Basecamp and EasySpeak
            </h1>
            <p className="text-lg text-navy-100 max-w-xl leading-relaxed">
              Get a complete view of every member's Pathways progress in minutes instead of
              hours.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-2">
              <Button variant="primary" onClick={() => scrollToId("get-started")}>
                Become an Early Tester
              </Button>
              <Button variant="ghost" onClick={() => scrollToId("screenshots")}>
                Watch Demo
              </Button>
            </div>
            <p className="text-sm text-navy-200 mt-2">
              No AI. No extra passwords. Uses your existing browser sessions.
            </p>
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

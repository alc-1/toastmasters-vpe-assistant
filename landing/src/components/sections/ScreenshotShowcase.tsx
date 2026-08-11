import { screenshots } from "../../data/screenshots";
import BrowserFrameMockup from "../ui/BrowserFrameMockup";
import Lightbox, { useLightbox } from "../ui/Lightbox";
import Section from "../ui/Section";
import SectionHeading from "../ui/SectionHeading";

export default function ScreenshotShowcase() {
  const lightbox = useLightbox();

  return (
    <Section id="screenshots" tone="white">
      <SectionHeading eyebrow="See It In Action" title="What You'll See in the Extension" />

      <div className="mt-14 grid sm:grid-cols-2 gap-10">
        {screenshots.map((shot) => (
          <div key={shot.id} className="flex flex-col gap-4">
            <BrowserFrameMockup urlLabel={shot.title}>
              <button
                type="button"
                onClick={() => lightbox.open({ src: shot.image, alt: shot.title })}
                aria-label={`View larger screenshot: ${shot.title}`}
                className="group relative block h-64 w-full cursor-zoom-in sm:h-72 lg:h-80"
              >
                <img
                  src={shot.image}
                  alt={shot.title}
                  className="h-full w-full object-contain object-center"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-navy-950/0 group-hover:bg-navy-950/40 transition-colors">
                  <span className="rounded-full bg-navy-950/70 px-3 py-1.5 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Click to enlarge
                  </span>
                </span>
              </button>
            </BrowserFrameMockup>
            <div>
              <h3 className="font-semibold text-navy-950">{shot.title}</h3>
              <p className="text-sm text-navy-700/80">{shot.caption}</p>
            </div>
          </div>
        ))}
      </div>

      <Lightbox image={lightbox.image} onClose={lightbox.close} />
    </Section>
  );
}

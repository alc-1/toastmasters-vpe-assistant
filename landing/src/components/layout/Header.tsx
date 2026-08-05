import logo from "../../assets/logo-512.png";
import { navLinks } from "../../data/nav";
import { scrollToId } from "../../lib/scrollToId";
import Button from "../ui/Button";
import Container from "../ui/Container";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-silver-light bg-white/90 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center justify-between">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="flex items-center gap-2 font-semibold text-navy-950"
          >
            <img src={logo} alt="" className="h-8 w-8 rounded-md" />
            <span className="hidden sm:inline">Toastmasters VPE Assistant</span>
          </a>

          <nav className="hidden lg:flex items-center gap-6" aria-label="Primary">
            {navLinks.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => scrollToId(link.id)}
                className="text-sm font-medium text-navy-700 hover:text-navy-950 transition-colors"
              >
                {link.label}
              </button>
            ))}
          </nav>

          <Button variant="primary" className="px-4 py-2" onClick={() => scrollToId("get-started")}>
            Become an Early Tester
          </Button>
        </div>
      </Container>
    </header>
  );
}

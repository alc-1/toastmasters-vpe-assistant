import logo from "../../assets/logo-512.png";
import { navLinks } from "../../data/nav";
import { CHROME_WEB_STORE_URL } from "../../data/releaseInfo";
import { scrollToId } from "../../lib/scrollToId";
import Button from "../ui/Button";
import Container from "../ui/Container";

interface Props {
  page?: "home" | "privacy";
}

export default function Header({ page = "home" }: Props) {
  const isHome = page === "home";

  return (
    <header className="sticky top-0 z-50 border-b border-silver-light bg-white/90 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center justify-between">
          <a
            href={isHome ? "#top" : "./index.html"}
            onClick={
              isHome
                ? (e) => {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                : undefined
            }
            className="flex items-center gap-2 font-semibold text-navy-950"
          >
            <img src={logo} alt="" className="h-8 w-8 rounded-md" />
            <span className="hidden sm:inline">Toastmasters VPE Assistant</span>
          </a>

          <nav className="hidden lg:flex items-center gap-6" aria-label="Primary">
            {navLinks.map((link) =>
              isHome ? (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => scrollToId(link.id)}
                  className="text-sm font-medium text-navy-700 hover:text-navy-950 transition-colors"
                >
                  {link.label}
                </button>
              ) : (
                <a
                  key={link.id}
                  href={`./index.html#${link.id}`}
                  className="text-sm font-medium text-navy-700 hover:text-navy-950 transition-colors"
                >
                  {link.label}
                </a>
              ),
            )}
          </nav>

          <Button
            variant="primary"
            className="px-4 py-2"
            href={CHROME_WEB_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Install
          </Button>
        </div>
      </Container>
    </header>
  );
}

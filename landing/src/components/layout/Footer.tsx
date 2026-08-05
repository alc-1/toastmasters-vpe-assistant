import Container from "../ui/Container";

export default function Footer() {
  return (
    <footer className="bg-navy-950 py-10 text-navy-200">
      <Container>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
          <p>Toastmasters VPE Assistant — an independent, unofficial community project.</p>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/alc-1/toastmasters-vpe-assistant"
              className="hover:text-white transition-colors"
            >
              Source on GitHub
            </a>
            <span className="text-navy-700">MIT License</span>
          </div>
        </div>
      </Container>
    </footer>
  );
}

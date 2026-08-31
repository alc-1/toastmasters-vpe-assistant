import Footer from "./components/layout/Footer";
import Header from "./components/layout/Header";
import BenefitsGrid from "./components/sections/BenefitsGrid";
import BuiltByToastmaster from "./components/sections/BuiltByToastmaster";
import FAQ from "./components/sections/FAQ";
import FinalCTA from "./components/sections/FinalCTA";
import HelpShapeTheTool from "./components/sections/HelpShapeTheTool";
import Hero from "./components/sections/Hero";
import Problem from "./components/sections/Problem";
import ScreenshotShowcase from "./components/sections/ScreenshotShowcase";
import Solution from "./components/sections/Solution";
import TrustPrivacy from "./components/sections/TrustPrivacy";
import Workflow from "./components/sections/Workflow";

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Problem />
        <Solution />
        <BenefitsGrid />
        <ScreenshotShowcase />
        <Workflow />
        <HelpShapeTheTool />
        <BuiltByToastmaster />
        <TrustPrivacy />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}

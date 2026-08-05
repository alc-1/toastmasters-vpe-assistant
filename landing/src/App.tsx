import Footer from "./components/layout/Footer";
import Header from "./components/layout/Header";
import BenefitsGrid from "./components/sections/BenefitsGrid";
import FAQ from "./components/sections/FAQ";
import FinalCTA from "./components/sections/FinalCTA";
import GetStarted from "./components/sections/GetStarted";
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
        <Workflow />
        <ScreenshotShowcase />
        <TrustPrivacy />
        <GetStarted />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}

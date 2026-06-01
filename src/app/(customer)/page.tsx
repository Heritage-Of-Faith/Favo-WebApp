// Landing page — owner: Nikao (task N3)
// Renders without JavaScript. Lighthouse mobile ≥ 90. Docs: docs/DESIGN.md

import Hero from "@/components/landing/Hero";
import NumbersStrip from "@/components/landing/NumbersStrip";
import AboutSection from "@/components/landing/AboutSection";
import VisitSection from "@/components/landing/VisitSection";

export const metadata = {
  title: "FAVO Café — Speciality Coffee, Cape Town",
  description:
    "Single-origin, no shortcuts. Every cup names the farm, the harvest, and the roast date.",
};

export default function LandingPage() {
  return (
    <main>
      <Hero />
      <NumbersStrip />
      <AboutSection />
      <VisitSection />
    </main>
  );
}

// Landing page — owner: Nikao (task N3)
// Renders without JavaScript. Lighthouse mobile ≥ 90. Docs: docs/DESIGN.md

import Hero from "@/components/landing/Hero";
import AboutSection from "@/components/landing/AboutSection";
import OperatingHours from "@/components/shared/OperatingHours";
import VisitSection from "@/components/landing/VisitSection";

export default function LandingPage() {
  return (
    <main>
      <Hero />
      <AboutSection />
      <OperatingHours />
      <VisitSection />
    </main>
  );
}

// Landing page — owner: Nikao (task N3)
// Renders without JavaScript. Lighthouse mobile ≥ 90. Docs: docs/DESIGN.md

import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import NumbersStrip from "@/components/landing/NumbersStrip";
import AboutSection from "@/components/landing/AboutSection";
import PhotoBand from "@/components/landing/PhotoBand";
import VisitSection from "@/components/landing/VisitSection";
import Footer from "@/components/landing/Footer";

export const metadata = {
  title: "FAVO Café — Heritage of Faith, Emalahleni",
  description:
    "The café at Heritage of Faith Ministries. Good coffee, real community. 7 Duiker Street, Reyno Ridge.",
};

export default function LandingPage() {
  return (
    <main>
      <Header />
      <Hero />
      <NumbersStrip />
      <AboutSection />
      <PhotoBand />
      <VisitSection />
      <Footer />
    </main>
  );
}

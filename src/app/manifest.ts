import type { MetadataRoute } from "next";

// PWA metadata requires literal hex — maps to var(--color-coffee-bean)
const COFFEE_BEAN = "#1C0501";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FAVO Café",
    short_name: "FAVO",
    description: "Order coffee. Earn rewards. Every visit counts.",
    start_url: "/",
    display: "standalone",
    background_color: COFFEE_BEAN,
    theme_color: COFFEE_BEAN,
    orientation: "portrait",
    icons: [
      // SVG first (crisp where supported), then PNG fallbacks for installability.
      {
        src: "/brand/logo-monogram.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

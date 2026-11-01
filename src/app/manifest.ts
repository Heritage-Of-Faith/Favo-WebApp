import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION } from "@/lib/site";

// PWA metadata requires literal hex — maps to var(--color-coffee-bean)
const COFFEE_BEAN = "#1C0501";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FAVO Café",
    short_name: "FAVO",
    // SEC-7: same true description as the site metadata.
    description: SITE_DESCRIPTION,
    start_url: "/customer", // one manifest serves both apps; staff add the icon from /staff/login
    display: "standalone",
    background_color: COFFEE_BEAN,
    theme_color: COFFEE_BEAN,
    orientation: "any", // phones and iPads, either way up

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

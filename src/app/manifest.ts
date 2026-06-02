import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FAVO Café",
    short_name: "FAVO",
    description: "Order coffee. Earn rewards. Every visit counts.",
    start_url: "/",
    display: "standalone",
    background_color: "#1C0501",
    theme_color: "#1C0501",
    orientation: "portrait",
    icons: [
      {
        src: "/brand/logos/logo-monogram.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/brand/logos/logo-monogram.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}

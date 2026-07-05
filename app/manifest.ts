import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.longName,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF7",
    theme_color: SITE.brandColor,
    lang: "ko",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "maskable",
      },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}

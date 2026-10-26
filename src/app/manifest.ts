import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Simmer",
    short_name: "Simmer",
    description: "Family meals, planned with care.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F6F0",
    theme_color: "#94B08A",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Simmer",
    short_name: "Simmer",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF6F1",
    theme_color: "#D9512F",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

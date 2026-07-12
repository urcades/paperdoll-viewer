import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  // Served from https://urcades.github.io/paperdoll-viewer/ on GitHub Pages;
  // dev and local preview stay at the root.
  base: process.env.GITHUB_PAGES ? "/paperdoll-viewer/" : "/",
  plugins: [svelte()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false
  },
  test: {
    environment: "jsdom"
  }
});

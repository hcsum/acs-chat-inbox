import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/; the workflow sets DEMO_BASE.
  base: process.env.DEMO_BASE ?? "/",
  plugins: [react()],
  // The demo imports the library from `../../src`, so those files resolve React
  // from the root install. Without dedupe the bundle gets two React copies and
  // the hooks throw ("Cannot read properties of null (reading 'useState')").
  resolve: { dedupe: ["react", "react-dom"] },
  server: { port: 5173, open: true },
});

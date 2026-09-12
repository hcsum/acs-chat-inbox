import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/; the workflow sets DEMO_BASE.
  base: process.env.DEMO_BASE ?? "/",
  plugins: [react()],
  server: { port: 5173, open: true },
});

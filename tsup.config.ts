import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/styles.css"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom"],
  loader: { ".css": "copy" },
  // Adds the `"use client"` directive (see the script for why it cannot be a
  // `banner`) and the `.d.css.ts` types for the stylesheet.
  onSuccess: "node scripts/postbuild.mjs",
});

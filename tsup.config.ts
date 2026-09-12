import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts", "src/styles.css"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom"],
  loader: { ".css": "copy" },
  // `postbuild` adds the `"use client"` directive (see the script for why it
  // cannot be a `banner`) and the `.d.css.ts` types for the stylesheet. In a
  // one-shot build the `build` script runs it after tsup exits: `onSuccess`
  // fires when the JS bundles are done, which races the declaration build and
  // fails on a clean `dist`. Watch mode has no "after", so it keeps `onSuccess`.
  ...(options.watch ? { onSuccess: "node scripts/postbuild.mjs" } : {}),
}));

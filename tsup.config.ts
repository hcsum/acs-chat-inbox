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
  // TypeScript resolves types for `import "pkg/styles.css"` from a
  // `.d.css.ts` file, which tsup does not emit on its own.
  onSuccess:
    "node -e \"require('fs').copyFileSync('dist/styles.d.ts','dist/styles.d.css.ts')\"",
});

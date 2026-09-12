import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

// TypeScript resolves types for `import "pkg/styles.css"` from a `.d.css.ts`
// file, which tsup does not emit on its own.
copyFileSync("dist/styles.d.ts", "dist/styles.d.css.ts");

/**
 * `banner` cannot deliver `"use client"`: tsup's `treeshake` pass runs the bundle
 * through rollup afterwards, and rollup drops module-level directives ("Module
 * level directives cause errors when bundled"). So the directive goes on after
 * the build, and each sourcemap gets one extra leading `;` in its mappings —
 * semicolons separate lines there, so that keeps every mapping on its own line.
 */
for (const file of ["dist/index.js", "dist/index.cjs"]) {
  const code = readFileSync(file, "utf8");
  if (code.startsWith('"use client"')) continue;
  writeFileSync(file, `"use client";\n${code}`);

  const mapFile = `${file}.map`;
  const map = JSON.parse(readFileSync(mapFile, "utf8"));
  map.mappings = `;${map.mappings}`;
  writeFileSync(mapFile, JSON.stringify(map));
}

// Bundles Sentinel into one Vercel function using the Build Output API
// (https://vercel.com/docs/build-output-api). Vercel runs this as the build
// command and serves .vercel/output as is: every path goes to the function.
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const out = ".vercel/output";
const fn = `${out}/functions/index.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: ["src/vercel.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // CommonJS dependencies inside an ESM bundle expect require, __filename and
  // __dirname (e.g. "bindings", which looks for optional native add-ons).
  banner: {
    js: [
      "import { createRequire as __cr } from 'node:module';",
      "import { fileURLToPath as __fu } from 'node:url';",
      "import { dirname as __dn } from 'node:path';",
      "const require = __cr(import.meta.url);",
      "const __filename = __fu(import.meta.url);",
      "const __dirname = __dn(__filename);",
    ].join(" "),
  },
  // Optional native speed-ups for websockets. The code falls back without them.
  external: ["bufferutil", "utf-8-validate"],
  legalComments: "none",
  logLevel: "info",
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 60 }, null, 2),
);
writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }, null, 2));
console.log("Vercel output ready in", out);

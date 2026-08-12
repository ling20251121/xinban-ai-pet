import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";

const exec = promisify(execFile);
const environment = { ...process.env, XINBAN_RUNTIME: "node-postgres" };
// Invoke the installed CLI with the current Node runtime. This avoids package
// manager wrappers attempting an interactive node_modules reinstall in CI.
const command = process.execPath;
const commandArguments = ["node_modules/vinext/dist/cli.js", "build"];

await exec(command, commandArguments, {
  env: environment,
  maxBuffer: 16 * 1024 * 1024,
});
await build({
  entryPoints: ["server/register-postgres.ts"],
  outfile: "dist/node-register/register-postgres.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { "@": "." },
  plugins: [{
    name: "node-runtime-environment",
    setup(build) {
      build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
        path: "cloudflare:workers",
        namespace: "xinban-node-runtime",
      }));
      build.onLoad(
        { filter: /.*/, namespace: "xinban-node-runtime" },
        () => ({ contents: "export const env = process.env;", loader: "js" }),
      );
    },
  }],
});

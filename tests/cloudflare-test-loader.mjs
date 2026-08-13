export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { shortCircuit: true, url: "test-cloudflare:workers" };
  }
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    const hasExtension = /\.[cm]?[jt]sx?$/u.test(relative);
    let target = new URL(`../${relative}${hasExtension ? "" : ".ts"}`, import.meta.url);
    if (relative === "db") target = new URL("../db/index.ts", import.meta.url);
    return {
      shortCircuit: true,
      url: target.href,
    };
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = new URL(specifier, context.parentURL);
    if (!/\.[cm]?[jt]sx?$/u.test(resolved.pathname)) resolved.pathname += ".ts";
    return { shortCircuit: true, url: resolved.href };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "test-cloudflare:workers") {
    return {
      format: "module",
      shortCircuit: true,
      source: `
        export const env = new Proxy({}, {
          get(_target, property) {
            return globalThis.__CLOUDFLARE_TEST_ENV__?.[property];
          }
        });
      `,
    };
  }
  return nextLoad(url, context);
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { shortCircuit: true, url: "test-cloudflare:workers" };
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

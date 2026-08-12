process.env.XINBAN_RUNTIME = "node-postgres";

const runtime = await import("../dist/node-register/register-postgres.mjs");
const { startProdServer } = await import("vinext/server/prod-server");
const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

const { server } = await startProdServer({ port, host, outDir: "dist" });

async function stop() {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await runtime.shutdown();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

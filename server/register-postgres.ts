import { clearRuntimeOverride, installRuntimeOverride } from "@/db";
import { createPostgresDatabase } from "@/lib/postgres-adapter";
import { assertAdultOnlyDatabaseIsClean, assertSandboxDatabaseIsSynthetic } from "@/lib/public-demo";

const runtime = createPostgresDatabase(process.env);
await assertAdultOnlyDatabaseIsClean(runtime.database, runtime.runtime);
await assertSandboxDatabaseIsSynthetic(runtime.database, runtime.runtime);
installRuntimeOverride({ database: runtime.database, runtime: runtime.runtime });

async function shutdown(): Promise<void> {
  clearRuntimeOverride();
  await runtime.close();
}

export { shutdown };

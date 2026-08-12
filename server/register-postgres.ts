import { clearRuntimeOverride, installRuntimeOverride } from "@/db";
import { createPostgresDatabase } from "@/lib/postgres-adapter";
import { assertAdultOnlyDatabaseIsClean } from "@/lib/public-demo";

const runtime = createPostgresDatabase(process.env);
await assertAdultOnlyDatabaseIsClean(runtime.database, runtime.runtime);
installRuntimeOverride({ database: runtime.database, runtime: runtime.runtime });

async function shutdown(): Promise<void> {
  clearRuntimeOverride();
  await runtime.close();
}

export { shutdown };

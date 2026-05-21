/**
 * Apply SQL migrations to Supabase Postgres.
 * Usage: npx tsx --env-file=.env.local scripts/run-migrations.ts
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const conn = process.env.Supabase_Database_Connection_String;
if (!conn) {
  console.error("Missing Supabase_Database_Connection_String");
  process.exit(1);
}

async function main() {
  const dir = join(process.cwd(), "services", "supabase", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  console.log(`> ${files.length} migration file(s) in ${dir}`);

  const sql = postgres(conn!, { ssl: "require", max: 1 });
  try {
    for (const f of files) {
      const body = await readFile(join(dir, f), "utf8");
      console.log(`> applying ${f} (${body.length} bytes)`);
      await sql.unsafe(body);
    }
    console.log("> migrations OK");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("MIGRATION FAILED:", e);
  process.exit(1);
});

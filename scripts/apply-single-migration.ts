/**
 * Apply a single SQL file. Usage:
 *   npx tsx --env-file=.env.local scripts/apply-single-migration.ts <path>
 */
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const conn = process.env.Supabase_Database_Connection_String;
if (!conn) {
  console.error("Missing Supabase_Database_Connection_String");
  process.exit(1);
}
const file = process.argv[2];
if (!file) {
  console.error("Usage: apply-single-migration.ts <path>");
  process.exit(1);
}

async function main() {
  const body = await readFile(file, "utf8");
  console.log(`> applying ${file} (${body.length} bytes)`);
  const sql = postgres(conn!, { ssl: "require", max: 1 });
  try {
    await sql.unsafe(body);
    console.log("> ok");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

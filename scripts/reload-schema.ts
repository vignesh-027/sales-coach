import postgres from "postgres";

async function main() {
  const conn = process.env.Supabase_Database_Connection_String;
  if (!conn) process.exit(1);
  const sql = postgres(conn, { ssl: "require", max: 1 });
  await sql.unsafe("notify pgrst, 'reload schema';");
  console.log("> notified pgrst");
  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

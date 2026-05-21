import { supabaseAdmin } from "../services/supabase/client-admin";

(async () => {
  const s = supabaseAdmin();
  const { data: before } = await s.from("app_settings").select("*").limit(5);
  console.log("BEFORE app_settings:", JSON.stringify(before, null, 2));

  const { error } = await s
    .from("app_settings")
    .update({ llm_model: "claude-sonnet-4-5-20250929" })
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) console.error("update error:", error);

  const { data: after } = await s.from("app_settings").select("*").limit(5);
  console.log("AFTER app_settings:", JSON.stringify(after, null, 2));
})();

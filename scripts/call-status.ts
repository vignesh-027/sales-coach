import { supabaseAdmin } from "../services/supabase/client-admin";

const id = process.argv[2];
if (!id) process.exit(1);

(async () => {
  const s = supabaseAdmin();
  const { data } = await s
    .from("calls")
    .select("process_status, process_error")
    .eq("id", id)
    .single();
  console.log(JSON.stringify(data));
})();

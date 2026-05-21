import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/app/_components/current-user";
import { listAllUsers } from "@/services/supabase/queries/users";
import { getAppSettings } from "@/services/supabase/queries/app-settings";
import {
  LLM_OPTIONS,
  DEFAULT_LLM_MODEL,
} from "@/services/anthropic/models";
import {
  RERANK_OPTIONS,
  DEFAULT_RERANK_MODEL,
} from "@/services/voyage/rerank-models";
import {
  VOYAGE_EMBEDDING_MODEL,
  VOYAGE_EMBEDDING_DIM,
} from "@/services/voyage/client";
import { AdminUsersClient } from "./admin-users-client";

export default async function AdminUsersPage() {
  const me = await getCurrentAppUser();
  if (!me.is_admin) redirect("/calls");
  const [users, settings] = await Promise.all([
    listAllUsers(),
    getAppSettings().catch(() => ({
      llm_model: DEFAULT_LLM_MODEL,
      rerank_model: DEFAULT_RERANK_MODEL,
      updated_at: new Date().toISOString(),
      updated_by: null as string | null,
    })),
  ]);
  return (
    <AdminUsersClient
      initialUsers={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        is_admin: u.is_admin,
        is_salesperson: u.is_salesperson,
        is_client: u.is_client,
        auth_user_id: u.auth_user_id,
        created_at: u.created_at,
      }))}
      initialLlmModel={settings.llm_model}
      initialRerankModel={settings.rerank_model}
      llmOptions={LLM_OPTIONS.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        tier: o.tier,
        cost_per_mtok_input: o.cost_per_mtok_input,
        cost_per_mtok_output: o.cost_per_mtok_output,
      }))}
      rerankOptions={RERANK_OPTIONS.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        tier: o.tier,
        cost_per_mtok: o.cost_per_mtok,
      }))}
      embedding={{
        provider: "Voyage AI",
        model: VOYAGE_EMBEDDING_MODEL,
        dim: VOYAGE_EMBEDDING_DIM,
        notes: "1024-d · multilingual · paid",
      }}
    />
  );
}

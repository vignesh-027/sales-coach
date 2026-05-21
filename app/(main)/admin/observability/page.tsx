import { getCurrentAppUser } from "@/app/_components/current-user";
import {
  voyageUsageLastNDays,
  voyageLifetimeTokens,
} from "@/services/supabase/queries/voyage-usage";
import {
  analysisAveragesLastNDays,
  recentAnalyses,
} from "@/services/supabase/queries/call-analysis-inputs";
import { claudeUsageLastNDays } from "@/services/supabase/queries/call-reports";
import { ObservabilityClient } from "./observability-client";

// Observability is read-only — usage rollups + retrieval funnel averages.
// Open to all signed-in users (the getCurrentAppUser() call still gates
// against unauthenticated access via its own redirect).
export default async function ObservabilityPage() {
  await getCurrentAppUser();
  const [usage, lifetime, claude, averages, recent] = await Promise.all([
    voyageUsageLastNDays(30),
    voyageLifetimeTokens(),
    claudeUsageLastNDays(30),
    analysisAveragesLastNDays(30),
    recentAnalyses(20),
  ]);
  return (
    <ObservabilityClient
      usage={usage}
      lifetime={lifetime}
      claude={claude}
      averages={averages}
      recent={recent}
    />
  );
}

import { NextResponse } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import { getUserByAuthId } from "@/services/supabase/queries/users";
import {
  monthlyUsageByModel,
  recentScopedUsage,
} from "@/services/supabase/queries/model-usage";

export const runtime = "nodejs";

// Open to any signed-in app user. No admin gate.
async function requireSignedInAppUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const me = await getUserByAuthId(data.user.id);
  return me ?? null;
}

export async function GET(req: Request) {
  if (!(await requireSignedInAppUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const now = new Date();
  const yearParam = Number(url.searchParams.get("year"));
  const monthParam = Number(url.searchParams.get("month"));
  const year =
    Number.isInteger(yearParam) && yearParam >= 2020 && yearParam <= 2100
      ? yearParam
      : now.getUTCFullYear();
  const month =
    Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : now.getUTCMonth() + 1;

  const [usage, recent] = await Promise.all([
    monthlyUsageByModel({ year, month }),
    recentScopedUsage({ year, month, limit: 50 }),
  ]);
  return NextResponse.json({ year, month, usage, recent });
}

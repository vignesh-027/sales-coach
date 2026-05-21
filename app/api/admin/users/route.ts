import { NextResponse } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import {
  getUserByAuthId,
  listAllUsers,
} from "@/services/supabase/queries/users";

export const runtime = "nodejs";

async function requireAdmin() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const me = await getUserByAuthId(data.user.id);
  if (!me?.is_admin) return null;
  return me;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const users = await listAllUsers();
  return NextResponse.json({ users });
}

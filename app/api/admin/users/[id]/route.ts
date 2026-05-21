import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import {
  deleteUser,
  getUserByAuthId,
  getUserById,
  updateUser,
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

interface PatchBody {
  name?: string;
  email?: string | null;
  phone?: string | null;
  is_admin?: boolean;
  is_salesperson?: boolean;
  is_client?: boolean;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.name === "string" && !body.name.trim()) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }
  if (body.email !== undefined) {
    const target = await getUserById(id);
    if (target?.auth_user_id) {
      const nextEmail = (body.email ?? "").trim().toLowerCase();
      const currentEmail = (target.email ?? "").trim().toLowerCase();
      if (nextEmail !== currentEmail) {
        return NextResponse.json(
          { error: "email is locked once the user has signed in" },
          { status: 400 },
        );
      }
    }
  }
  const updated = await updateUser(id, body);
  return NextResponse.json({ user: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await requireAdmin();
  if (!me) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (id === me.id) {
    return NextResponse.json(
      { error: "you cannot delete your own account" },
      { status: 400 },
    );
  }
  await deleteUser(id);
  return NextResponse.json({ ok: true });
}

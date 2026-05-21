import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/services/supabase/server";
import {
  createOrTagDictUser,
  getUserByAuthId,
  searchUsersByRole,
  type UserRole,
} from "@/services/supabase/queries/users";

export const runtime = "nodejs";

function asRole(s: string | null): UserRole | null {
  return s === "salesperson" || s === "client" ? s : null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const role = asRole(url.searchParams.get("role"));
  if (!role) {
    return NextResponse.json({ error: "role must be salesperson|client" }, { status: 400 });
  }
  const q = url.searchParams.get("q");
  const rows = await searchUsersByRole(role, q);
  return NextResponse.json({
    users: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
    })),
  });
}

interface PostBody {
  name?: string;
  email?: string;
  phone?: string;
  role?: UserRole;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Any signed-in app user may add dictionary entries (salesperson/client)
  // from the Add Call screen. We only verify they have an app row.
  const me = await getUserByAuthId(authData.user.id);
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const role = asRole(body.role ?? null);
  if (!role) {
    return NextResponse.json({ error: "role must be salesperson|client" }, { status: 400 });
  }
  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  // Role-aware validation, mirrored from DictCombobox.validateNew():
  //   salesperson → email mandatory + must be on @soexcellence.com
  //   client      → email optional, any domain
  const rawEmail = body.email?.trim() ?? "";
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (role === "salesperson") {
    if (!rawEmail) {
      return NextResponse.json(
        { error: "email required for salesperson" },
        { status: 400 },
      );
    }
    if (!emailRe.test(rawEmail)) {
      return NextResponse.json({ error: "invalid email" }, { status: 400 });
    }
    if (!/@soexcellence\.com$/i.test(rawEmail)) {
      return NextResponse.json(
        { error: "salesperson email must end with @soexcellence.com" },
        { status: 400 },
      );
    }
  } else if (rawEmail && !emailRe.test(rawEmail)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  const u = await createOrTagDictUser({
    name,
    email: rawEmail ? rawEmail : null,
    phone: body.phone ?? null,
    role,
  });
  return NextResponse.json({
    user: { id: u.id, name: u.name, email: u.email, phone: u.phone },
  });
}

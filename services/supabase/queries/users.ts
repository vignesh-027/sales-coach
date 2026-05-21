import { supabaseAdmin } from "../client-admin";

export interface AppUser {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  role: string;
  auth_user_id: string | null;
  is_admin: boolean;
  is_salesperson: boolean;
  is_client: boolean;
  created_at: string;
}

export type UserRole = "salesperson" | "client";

export async function getUserByAuthId(authUserId: string): Promise<AppUser | null> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as AppUser) ?? null;
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("*")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw error;
  return (data as AppUser) ?? null;
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as AppUser) ?? null;
}

export async function upsertAuthUser(input: {
  authUserId: string;
  email: string;
  fullName: string | null;
}): Promise<AppUser> {
  const existingByEmail = await getUserByEmail(input.email);
  if (existingByEmail) {
    const patch: Partial<AppUser> = { auth_user_id: input.authUserId };
    if (input.fullName && input.fullName.trim()) {
      patch.name = input.fullName.trim();
    }
    const { data, error } = await supabaseAdmin()
      .from("users")
      .update(patch)
      .eq("id", existingByEmail.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as AppUser;
  }
  const { data, error } = await supabaseAdmin()
    .from("users")
    .insert({
      email: input.email,
      name: input.fullName ?? input.email.split("@")[0],
      auth_user_id: input.authUserId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AppUser;
}

export async function searchUsersByRole(
  role: UserRole,
  q: string | null,
): Promise<AppUser[]> {
  const flag = role === "salesperson" ? "is_salesperson" : "is_client";
  let query = supabaseAdmin()
    .from("users")
    .select("*")
    .eq(flag, true)
    .order("name", { ascending: true })
    .limit(q ? 8 : 20);
  if (q && q.trim()) query = query.ilike("name", `${q.trim()}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data as AppUser[]) ?? [];
}

export async function findUserByName(name: string): Promise<AppUser | null> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("*")
    .ilike("name", name.trim())
    .maybeSingle();
  if (error) throw error;
  return (data as AppUser) ?? null;
}

export async function createOrTagDictUser(input: {
  name: string;
  email?: string | null;
  phone?: string | null;
  role: UserRole;
}): Promise<AppUser> {
  const flag = input.role === "salesperson" ? "is_salesperson" : "is_client";
  const cleanEmail = input.email?.trim().toLowerCase() || null;

  const existing =
    (cleanEmail ? await getUserByEmail(cleanEmail) : null) ??
    (await findUserByName(input.name));

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!(existing as unknown as Record<string, boolean>)[flag]) patch[flag] = true;
    if (!existing.email && cleanEmail) patch.email = cleanEmail;
    if (!existing.phone && input.phone?.trim()) patch.phone = input.phone.trim();
    if (Object.keys(patch).length === 0) return existing;
    const { data, error } = await supabaseAdmin()
      .from("users")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as AppUser;
  }
  const { data, error } = await supabaseAdmin()
    .from("users")
    .insert({
      name: input.name.trim(),
      email: cleanEmail,
      phone: input.phone?.trim() || null,
      [flag]: true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as AppUser;
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("users").delete().eq("id", id);
  if (error) throw error;
}

export async function listAllUsers(): Promise<AppUser[]> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as AppUser[]) ?? [];
}

export async function updateUser(
  id: string,
  patch: Partial<
    Pick<
      AppUser,
      "name" | "email" | "phone" | "is_admin" | "is_salesperson" | "is_client"
    >
  >,
): Promise<AppUser> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if ((k === "email" || k === "phone") && typeof v === "string" && !v.trim()) {
      clean[k] = null;
    } else {
      clean[k] = v;
    }
  }
  const { data, error } = await supabaseAdmin()
    .from("users")
    .update(clean)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as AppUser;
}

import { redirect } from "next/navigation";
import { supabaseServer } from "@/services/supabase/server";
import {
  getUserByAuthId,
  upsertAuthUser,
  type AppUser,
} from "@/services/supabase/queries/users";
import type { ProfileMenuUser } from "./profile-menu";

export async function getCurrentAppUser(): Promise<AppUser> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/signin");
  let me = await getUserByAuthId(data.user.id);
  if (!me) {
    const email = (data.user.email ?? "").toLowerCase();
    if (!email.endsWith("@soexcellence.com")) {
      await supabase.auth.signOut();
      redirect("/signin?error=domain");
    }
    me = await upsertAuthUser({
      authUserId: data.user.id,
      email,
      fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
    });
  }
  return me;
}

export function toMenuUser(me: AppUser): ProfileMenuUser {
  return { name: me.name, email: me.email, isAdmin: me.is_admin };
}

import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/app/_components/current-user";
import { listAllUsers } from "@/services/supabase/queries/users";
import { UsersClient } from "./users-client";

export default async function SettingsUsersPage() {
  const me = await getCurrentAppUser();
  if (!me.is_admin) redirect("/calls");
  const users = await listAllUsers();
  return (
    <UsersClient
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
    />
  );
}

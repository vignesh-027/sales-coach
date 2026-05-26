import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/app/_components/current-user";

export default async function SettingsIndexPage() {
  const me = await getCurrentAppUser();
  if (me.is_admin) redirect("/settings/configuration");
  redirect("/calls");
}

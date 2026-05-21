import { getCurrentAppUser } from "@/app/_components/current-user";
import AddCallClient from "./add-call-client";

export default async function AddCallPage() {
  const me = await getCurrentAppUser();
  return <AddCallClient isAdmin={me.is_admin} />;
}

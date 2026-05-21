import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/app/_components/current-user";
import AddKnowledgeClient from "./add-knowledge-client";

// Knowledge upload is admin-only. The Upload button in NavHeader is hidden
// for non-admins, but we still gate the page server-side in case someone
// types the URL directly.
export default async function AddKnowledgePage() {
  const me = await getCurrentAppUser();
  if (!me.is_admin) redirect("/knowledge");
  return <AddKnowledgeClient />;
}

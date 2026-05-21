import { getCurrentAppUser } from "@/app/_components/current-user";
import KnowledgeDetailClient from "./knowledge-detail-client";

export default async function KnowledgeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentAppUser();
  return <KnowledgeDetailClient id={id} isAdmin={me.is_admin} />;
}

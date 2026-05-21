import { getCurrentAppUser } from "@/app/_components/current-user";
import CallDetailClient from "./call-detail-client";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentAppUser();
  return <CallDetailClient id={id} isAdmin={me.is_admin} />;
}

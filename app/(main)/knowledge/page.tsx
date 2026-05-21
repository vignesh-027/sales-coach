import { getCurrentAppUser, toMenuUser } from "@/app/_components/current-user";
import KnowledgeClient from "./knowledge-client";

export default async function KnowledgePage() {
  const me = await getCurrentAppUser();
  return <KnowledgeClient user={toMenuUser(me)} />;
}

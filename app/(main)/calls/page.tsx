import { getCurrentAppUser, toMenuUser } from "@/app/_components/current-user";
import CallsClient from "./calls-client";

export default async function CallsPage() {
  const me = await getCurrentAppUser();
  return <CallsClient user={toMenuUser(me)} />;
}

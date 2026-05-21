import { redirect } from "next/navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.error) params.set("error", sp.error);
  if (sp.next) params.set("next", sp.next);
  const qs = params.toString();
  redirect(`/${qs ? `?${qs}` : ""}#signin`);
}

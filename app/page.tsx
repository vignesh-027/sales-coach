import { redirect } from "next/navigation";
import { Suspense } from "react";
import { supabaseServer } from "@/services/supabase/server";
import { LandingClient } from "./_landing/landing-client";

export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <HomeResolved searchParams={searchParams} />
    </Suspense>
  );
}

async function HomeResolved({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    redirect("/calls");
  }

  const url = process.env.Supabase_Project_URL!;
  const anonKey = process.env.Supabase_Anon_Key!;

  return (
    <LandingClient
      supabase={{ url, anonKey }}
      next={sp.next ?? "/calls"}
      error={sp.error}
    />
  );
}

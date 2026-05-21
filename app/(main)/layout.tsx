import { getCurrentAppUser, toMenuUser } from "@/app/_components/current-user";
import { NavHeader } from "@/app/_components/nav-header";

// Persistent layout for the top-nav "main" area: /calls, /knowledge,
// /admin/*. Next preserves layouts across child segment changes, so the
// NavHeader (brand + tabs + profile menu) mounts once and stays put while
// users navigate between Calls and Knowledge. No more re-mount flicker, no
// disappearing profile button during loading.tsx flashes.
export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentAppUser();
  return (
    <>
      <NavHeader
        user={toMenuUser(me)}
        supabase={{
          url: process.env.Supabase_Project_URL!,
          anonKey: process.env.Supabase_Anon_Key!,
        }}
      />
      {children}
    </>
  );
}

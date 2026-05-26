import { getCurrentAppUser } from "@/app/_components/current-user";
import { SettingsSidebar } from "./_components/settings-sidebar";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentAppUser();
  const items = [
    ...(me.is_admin
      ? [
          { href: "/settings/configuration", label: "Configuration" },
          { href: "/settings/users", label: "Manage Users" },
        ]
      : []),
  ];
  return (
    <main className="shell settings-shell">
      <section className="page-head">
        <h1 className="top-title">
          Settings<span className="dot">.</span>
        </h1>
      </section>
      <div className="settings-layout">
        <SettingsSidebar items={items} />
        <div className="settings-content">{children}</div>
      </div>
    </main>
  );
}

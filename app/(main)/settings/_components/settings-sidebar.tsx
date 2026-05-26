"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarItem {
  href: string;
  label: string;
}

export function SettingsSidebar({ items }: { items: SidebarItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="settings-sidebar" aria-label="Settings sections">
      <ul>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`settings-sidebar-item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

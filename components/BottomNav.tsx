"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 片手で押せるよう、1つあたりの高さを 56px 以上にしてある。 */
const TABS = [
  {
    href: "/",
    label: "買い物",
    icon: (
      <>
        <path d="M4 6h16l-1.5 9H6.5L5 3H2" />
        <circle cx="9" cy="20" r="1.4" />
        <circle cx="17" cy="20" r="1.4" />
      </>
    ),
  },
  {
    href: "/inventory",
    label: "在庫",
    icon: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M5 10h14M9 6.5v1M9 13.5v1.5" />
      </>
    ),
  },
  {
    href: "/recipes",
    label: "レシピ",
    icon: (
      <>
        <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
        <path d="M5 19.5A1.5 1.5 0 0 1 6.5 21H19" />
      </>
    ),
  },
  {
    href: "/plan",
    label: "献立",
    icon: (
      <>
        <rect x="3.5" y="5" width="17" height="16" rx="2" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </>
    ),
  },
  {
    href: "/spending",
    label: "家計",
    icon: (
      <>
        <path d="M8 5l4 5 4-5M12 10v9M8.5 13h7M8.5 16h7" />
      </>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/login")) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
      <ul className="flex">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 ${
                  active
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-neutral-400 dark:text-neutral-500"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.2 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {tab.icon}
                </svg>
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

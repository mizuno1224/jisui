"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 下のタブ。
 *
 * 【アイコンの決まり】
 *   viewBox="0 0 24 24" / fill="none" / stroke="currentColor"
 *   strokeLinecap と strokeLinejoin は <svg> に1回だけ書き、path には書かない。
 *   形は全部 <path>。rect や circle を混ぜない(線の太さの見え方が変わるため)。
 *
 * 【重さを揃える方法】
 *   太さを変えるのではなく、線の実際の長さを合わせる。
 *   どれも約70になるように形を調整してある。こうすると同じ strokeWidth のまま
 *   全部が同じ濃さに見える。以前は 2.05倍 の差があり、¥ だけ明らかに薄かった。
 *   健康(ハート+十字)は 69.3(ベジエを400分割して実測)。
 *
 * 【形が被らないようにする】
 *   24px では細部は見えず、外形だけが手掛かりになる。
 *   長方形は「予定(横長)」と「在庫(縦長)」の2つだけにし、
 *   レシピは閉じた本をやめて開いた本にした(閉じた本は冷蔵庫と同じ縦長の箱に見える)。
 *   健康はハート。丸い外形は家計の硬貨と近いが、あちらは正円で中に ¥ が入る。
 *   ハートは上がくぼんで下が尖るので、24px でも輪郭だけで見分けられる。
 *
 * 【7つに増やしたときの幅】
 *   タブは flex-1 の等分。padding もマージンも無いので 1 タブ = 画面幅 / 7。
 *     幅 390px(iPhone 14) … 55.7px
 *     幅 320px(一番狭い端末)… 45.7px
 *   中身でいちばん広いのは「買い物」の3文字で、10px × 3 = 30px。
 *   320px でも 45.7 > 30 なので折り返さない(whitespace-nowrap も付けてある)。
 *   **これ以上タブを増やすなら、ここを計算し直すこと。** 4文字のラベル(40px)を
 *   8等分(40px)に入れると、その瞬間に折り返して段が崩れる。
 */
const TABS = [
  {
    href: "/",
    label: "ホーム",
    // 家。屋根の頂点を y=4.1 に置き、他のアイコンの上端と光学的に揃えてある。
    // ドアは半円アーチ。四角いドアだと冷蔵庫の取っ手と紛らわしい。
    icon: (
      <>
        <path d="M3.9 10.3 12 4.1l8.1 6.2V19.3a1.6 1.6 0 0 1-1.6 1.6H5.5a1.6 1.6 0 0 1-1.6-1.6Z" />
        <path d="M10.2 20.9v-3.6a1.8 1.8 0 0 1 3.6 0v3.6" />
      </>
    ),
  },
  {
    href: "/plan",
    label: "予定",
    // カレンダー。本体を小さくし、上の爪を詰めて重さを揃えた。
    icon: (
      <>
        <path d="M7.4 6.2h9.2a2.4 2.4 0 0 1 2.4 2.4v8.8a2.4 2.4 0 0 1-2.4 2.4H7.4a2.4 2.4 0 0 1-2.4-2.4v-8.8a2.4 2.4 0 0 1 2.4-2.4Z" />
        <path d="M5 11.2h14" />
        <path d="M8.6 4.4v3.6" />
        <path d="M15.4 4.4v3.6" />
      </>
    ),
  },
  {
    href: "/shopping",
    label: "買い物",
    // 買い物カゴ。前のカートは輪郭が閉じておらず、斜線が本体を貫通していた。
    // 「フチ / 本体 / 取っ手」の3本に分けたので、意図しない線が出ない。
    icon: (
      <>
        <path d="M3 9.1h18" />
        <path d="M4.9 9.1 6.5 20Q6.8 21 7.9 21h8.2q1.1 0 1.4-1L19.1 9.1" />
        <path d="M8.2 9.1V7.2a3.8 3.8 0 0 1 7.6 0v1.9" />
      </>
    ),
  },
  {
    href: "/inventory",
    label: "在庫",
    // 冷蔵庫。取っ手の長さを左右対称にし、カレンダーより縦長・幅狭にした。
    icon: (
      <>
        <path d="M8 3.8h8a2.4 2.4 0 0 1 2.4 2.4v11.6a2.4 2.4 0 0 1-2.4 2.4H8a2.4 2.4 0 0 1-2.4-2.4V6.2A2.4 2.4 0 0 1 8 3.8Z" />
        <path d="M5.6 10.2h12.8" />
        <path d="M9.2 6.4v2" />
        <path d="M9.2 12.6v2" />
      </>
    ),
  },
  {
    href: "/recipes",
    label: "レシピ",
    // 開いた本。左右のページと中央の綴じ目の3本。線が重ならない。
    icon: (
      <>
        <path d="M12 7.4c-1.5-1.5-3.6-2.2-6.3-2.2a1.5 1.5 0 0 0-1.5 1.5v10.1a1.5 1.5 0 0 0 1.5 1.5c2.7 0 4.8.7 6.3 2.2" />
        <path d="M12 7.4c1.5-1.5 3.6-2.2 6.3-2.2a1.5 1.5 0 0 1 1.5 1.5v10.1a1.5 1.5 0 0 1-1.5 1.5c-2.7 0-4.8.7-6.3 2.2" />
        <path d="M12 7.4v13.1" />
      </>
    ),
  },
  {
    href: "/health",
    label: "健康",
    // ハート + 十字。線の長さは 59.3 + 10 = 69.3 で、他の約70に揃えてある。
    // 十字はハートの内側に収め、輪郭と交わらせない(24px で潰れるため)。
    icon: (
      <>
        <path d="M12 20.9C3.9 16.2 2.1 12.4 2.1 9.4 2.1 6.4 4.5 4.3 7.3 4.3 9.3 4.3 11 5.4 12 7c1-1.6 2.7-2.7 4.7-2.7 2.8 0 5.2 2.1 5.2 5.1 0 3-1.8 6.8-9.9 11.5Z" />
        <path d="M12 8.5v5" />
        <path d="M9.5 11h5" />
      </>
    ),
  },
  {
    href: "/spending",
    label: "家計",
    // 硬貨と ¥。裸の ¥ は他の6割の線量しかなく明らかに薄かったので円で囲った。
    // ¥ の横棒は1本。2本にすると 24px では棒の隙間が線幅より狭くなり潰れる。
    icon: (
      <>
        <path d="M20.2 12a8.2 8.2 0 1 1-16.4 0 8.2 8.2 0 1 1 16.4 0Z" />
        <path d="M9.3 8.6 12 11.5l2.7-2.9" />
        <path d="M12 11.5v5.1" />
        <path d="M9.4 14h5.2" />
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
          // ホームだけ完全一致。他は前方一致にして、子のページ
          // (/plan/chores、/spending/assets など)でも親のタブが点く。
          // "/shopping" が "/shopping-list" のような別ページを誤って
          // 点灯させないよう、区切りの "/" まで見る。
          const active =
            pathname === tab.href ||
            (tab.href !== "/" && pathname.startsWith(`${tab.href}/`));
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
                {/* 7等分だと 390px で1つ55.7px。「買い物」3文字が10pxで30pxなので折り返さない */}
                <span className="whitespace-nowrap text-[10px] font-medium">
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

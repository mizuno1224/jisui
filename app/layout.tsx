import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/BottomNav";
import { RegisterSW } from "@/components/RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "くらし",
  description: "ふたりの暮らしを1つに。買い物・在庫・レシピ・予定・家計。",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "くらし",
    statusBarStyle: "default",
  },
  // アイコンは app/icon.png と app/apple-icon.png(Next のファイル規約)から自動で入る
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android でキーボードが出たとき、画面自体を縮めてボタンを押せるようにする
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <BottomNav />
        <RegisterSW />
      </body>
    </html>
  );
}

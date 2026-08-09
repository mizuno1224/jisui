import { HomeScreen } from "@/components/HomeScreen";
import { RequireSession } from "@/components/RequireSession";

/*
 * アプリを開いて最初に出る画面。
 *
 * もとは買い物リストだった(設計書 3-2)。画面が10以上に増えて
 * 「家事の設定はどのタブの隅だったか」が分からなくなったので、
 * 今日のまとめと全ページへの入口を兼ねるホームに変えた。
 * 買い物リストは /shopping に移してある。
 *
 * manifest の start_url は "/" のまま。すでにホーム画面に追加済みの
 * PWA は追加した時点の start_url を握っているので、ここを変えると
 * 新旧の端末で着地点が割れる。"/" の中身を差し替えるほうが安全。
 */
export default function HomePage() {
  return (
    <RequireSession title="くらし">
      <HomeScreen />
    </RequireSession>
  );
}

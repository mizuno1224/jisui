import { RequireSession } from "@/components/RequireSession";
import { ShoppingListScreen } from "@/components/ShoppingListScreen";

/*
 * 買い物リスト。もとは "/" にあった画面。
 * ホーム画面を足したときにここへ移した。
 * "/" を開いていた古い Service Worker が残っていると
 * ここが真っ白に見えることがあるので、sw.js の VERSION は必ず上げること。
 */
export default function ShoppingPage() {
  return (
    <RequireSession title="買い物リスト">
      <ShoppingListScreen />
    </RequireSession>
  );
}

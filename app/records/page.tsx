import { RecordsScreen } from "@/components/RecordsScreen";
import { RequireSession } from "@/components/RequireSession";

/*
 * 記録の入口。
 *
 * 画面が20近くになり、「どこに何が残っているのか」が誰にも言えなくなった。
 * ここが【アプリが持っている記録の目録】で、種類・件数・見る場所を1画面に並べる。
 * ホームの「ほかの画面」はここに置き換えた(二重に持つと必ず食い違う)。
 */
export default function RecordsPage() {
  return (
    <RequireSession title="記録">
      <RecordsScreen />
    </RequireSession>
  );
}

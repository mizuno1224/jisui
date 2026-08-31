import { HealthScreen } from "@/components/HealthScreen";
import { RequireSession } from "@/components/RequireSession";

/*
 * 健康。
 *
 * 表は supabase/19_health.sql で作る。まだ流していない端末では
 * 画面が「19_health.sql を実行してください」と言う(空の画面を出さない)。
 */
export default function HealthPage() {
  return (
    <RequireSession title="健康">
      <HealthScreen />
    </RequireSession>
  );
}

import { ExamsScreen } from "@/components/ExamsScreen";
import { RequireSession } from "@/components/RequireSession";

export default function ExamsPage() {
  return (
    <RequireSession title="健康診断">
      <ExamsScreen />
    </RequireSession>
  );
}

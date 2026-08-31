import { CheckupsScreen } from "@/components/CheckupsScreen";
import { RequireSession } from "@/components/RequireSession";

export default function CheckupsPage() {
  return (
    <RequireSession title="検診・予防接種">
      <CheckupsScreen />
    </RequireSession>
  );
}

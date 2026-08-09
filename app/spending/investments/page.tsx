import { InvestmentsScreen } from "@/components/InvestmentsScreen";
import { RequireSession } from "@/components/RequireSession";

export default function InvestmentsPage() {
  return (
    <RequireSession title="投資">
      <InvestmentsScreen />
    </RequireSession>
  );
}

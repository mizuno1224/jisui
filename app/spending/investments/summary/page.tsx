import { InvestmentSummaryScreen } from "@/components/InvestmentSummaryScreen";
import { RequireSession } from "@/components/RequireSession";

export default function InvestmentSummaryPage() {
  return (
    <RequireSession title="投資のまとめ">
      <InvestmentSummaryScreen />
    </RequireSession>
  );
}

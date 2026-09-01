import { ExpenseRulesScreen } from "@/components/ExpenseRulesScreen";
import { RequireSession } from "@/components/RequireSession";

export default function RulesPage() {
  return (
    <RequireSession title="費目の決まり">
      <ExpenseRulesScreen />
    </RequireSession>
  );
}

import { RequireSession } from "@/components/RequireSession";
import { TodosScreen } from "@/components/TodosScreen";

export default function TodosPage() {
  return (
    <RequireSession title="やること">
      <TodosScreen />
    </RequireSession>
  );
}

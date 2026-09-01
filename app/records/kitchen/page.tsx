import { KitchenScreen } from "@/components/KitchenScreen";
import { RequireSession } from "@/components/RequireSession";

export default function KitchenPage() {
  return (
    <RequireSession title="台所の決めごと">
      <KitchenScreen />
    </RequireSession>
  );
}

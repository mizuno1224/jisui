import { InventoryScreen } from "@/components/InventoryScreen";
import { RequireSession } from "@/components/RequireSession";

export default function InventoryPage() {
  return (
    <RequireSession title="在庫">
      <InventoryScreen />
    </RequireSession>
  );
}

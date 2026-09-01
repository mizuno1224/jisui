import { ReceiptItemsScreen } from "@/components/ReceiptItemsScreen";
import { RequireSession } from "@/components/RequireSession";

export default function ReceiptsPage() {
  return (
    <RequireSession title="レシートの明細">
      <ReceiptItemsScreen />
    </RequireSession>
  );
}

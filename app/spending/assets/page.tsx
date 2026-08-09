import { AssetsScreen } from "@/components/AssetsScreen";
import { RequireSession } from "@/components/RequireSession";

export default function AssetsPage() {
  return (
    <RequireSession title="資産">
      <AssetsScreen />
    </RequireSession>
  );
}

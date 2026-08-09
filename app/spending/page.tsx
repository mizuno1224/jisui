import { SpendingScreen } from "@/components/SpendingScreen";
import { RequireSession } from "@/components/RequireSession";

export default function SpendingPage() {
  return (
    <RequireSession title="家計">
      <SpendingScreen />
    </RequireSession>
  );
}

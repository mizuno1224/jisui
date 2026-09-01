import { CookLogScreen } from "@/components/CookLogScreen";
import { RequireSession } from "@/components/RequireSession";

export default function CookingPage() {
  return (
    <RequireSession title="作った記録">
      <CookLogScreen />
    </RequireSession>
  );
}

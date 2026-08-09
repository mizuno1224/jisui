import { ChoresScreen } from "@/components/ChoresScreen";
import { RequireSession } from "@/components/RequireSession";

export default function ChoresPage() {
  return (
    <RequireSession title="家事">
      <ChoresScreen />
    </RequireSession>
  );
}

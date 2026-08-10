import { AskAiScreen } from "@/components/AskAiScreen";
import { RequireSession } from "@/components/RequireSession";

export default function AskAiPage() {
  return (
    <RequireSession title="AIに相談する">
      <AskAiScreen />
    </RequireSession>
  );
}

import { HandoffScreen } from "@/components/HandoffScreen";
import { RequireSession } from "@/components/RequireSession";

export default function HandoffPage() {
  return (
    <RequireSession title="チャットから取り込む">
      <HandoffScreen />
    </RequireSession>
  );
}

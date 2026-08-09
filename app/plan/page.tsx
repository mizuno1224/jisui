import { CalendarScreen } from "@/components/CalendarScreen";
import { RequireSession } from "@/components/RequireSession";

export default function PlanPage() {
  return (
    <RequireSession title="予定">
      <CalendarScreen />
    </RequireSession>
  );
}

import { RequireSession } from "@/components/RequireSession";
import { TagsScreen } from "@/components/TagsScreen";

export default function TagsPage() {
  return (
    <RequireSession title="予定のタグ">
      <TagsScreen />
    </RequireSession>
  );
}

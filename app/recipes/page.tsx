import { RecipeListScreen } from "@/components/RecipeListScreen";
import { RequireSession } from "@/components/RequireSession";

export default function RecipesPage() {
  return (
    <RequireSession title="レシピ">
      <RecipeListScreen />
    </RequireSession>
  );
}

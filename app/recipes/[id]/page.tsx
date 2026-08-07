import { RecipeDetailScreen } from "@/components/RecipeDetailScreen";

export default async function RecipePage({ params }: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  return <RecipeDetailScreen recipeId={Number(id)} />;
}

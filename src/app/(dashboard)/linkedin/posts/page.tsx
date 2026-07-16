import { listPosts, countByStatus } from "@/modules/linkedin/repositories/post-repo";
import { listThemes } from "@/modules/linkedin/repositories/theme-repo";
import { PostList } from "@/modules/linkedin/ui/post-list";

export const dynamic = "force-dynamic";

export default async function PostsPage() {
  const [posts, themes, counts] = await Promise.all([
    listPosts({ status: "queued" }),
    listThemes({ includeArchived: false }),
    countByStatus(),
  ]);

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Posts</h1>
        <p className="text-sm text-fg-muted mt-1">La file d'attente, les brouillons, l'historique.</p>
      </header>
      <PostList initialPosts={posts} initialStatus="queued" themes={themes} counts={counts} />
    </div>
  );
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listThemes } from "@/modules/linkedin/repositories/theme-repo";
import { PostNewTabs } from "@/modules/linkedin/ui/post-new-tabs";

export const dynamic = "force-dynamic";

export default async function NewPostPage() {
  const themes = await listThemes({ includeArchived: false });
  return (
    <div className="p-8 max-w-6xl">
      <Link href="/linkedin/posts" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-3">
        <ArrowLeft size={14} strokeWidth={1.5} />
        Retour aux posts
      </Link>
      <h1 className="text-2xl font-semibold mb-6">Nouveau post</h1>
      <PostNewTabs themes={themes} />
    </div>
  );
}

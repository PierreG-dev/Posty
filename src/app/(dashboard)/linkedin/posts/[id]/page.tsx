import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPost } from "@/modules/linkedin/repositories/post-repo";
import { listThemes } from "@/modules/linkedin/repositories/theme-repo";
import { PostEditor } from "@/modules/linkedin/ui/post-editor";
import { PublishButton } from "@/modules/linkedin/ui/publish-button";

export const dynamic = "force-dynamic";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [post, themes] = await Promise.all([getPost(id), listThemes({ includeArchived: false })]);
  if (!post) notFound();
  const canPublish = ["queued", "scheduled", "draft", "failed"].includes(post.status);
  return (
    <div className="p-8 max-w-6xl">
      <Link href="/linkedin/posts" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-3">
        <ArrowLeft size={14} strokeWidth={1.5} />
        Retour aux posts
      </Link>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Éditer le post</h1>
          <p className="mt-1 text-xs text-fg-muted font-mono">
            statut : {post.status}{post.linkedin.url ? ` · ${post.linkedin.url}` : ""}
          </p>
        </div>
        {canPublish ? <PublishButton postId={post._id} /> : null}
      </div>
      <PostEditor mode="edit" themes={themes} initial={post} />
    </div>
  );
}

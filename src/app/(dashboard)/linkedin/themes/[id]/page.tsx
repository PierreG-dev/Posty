import { notFound } from "next/navigation";
import Link from "next/link";
import { getTheme } from "@/modules/linkedin/repositories/theme-repo";
import { ThemeForm } from "@/modules/linkedin/ui/theme-form";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function EditThemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const theme = await getTheme(id);
  if (!theme) notFound();
  return (
    <div className="p-8 max-w-5xl">
      <Link href="/linkedin/themes" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-3">
        <ArrowLeft size={14} strokeWidth={1.5} />
        Retour
      </Link>
      <h1 className="text-2xl font-semibold mb-6">
        {theme.emoji} {theme.name}
      </h1>
      <ThemeForm mode="edit" initial={theme} />
    </div>
  );
}

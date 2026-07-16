import { ThemeForm } from "@/modules/linkedin/ui/theme-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NewThemePage() {
  return (
    <div className="p-8 max-w-5xl">
      <Link href="/linkedin/themes" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-3">
        <ArrowLeft size={14} strokeWidth={1.5} />
        Retour
      </Link>
      <h1 className="text-2xl font-semibold mb-6">Nouveau thème</h1>
      <ThemeForm mode="create" />
    </div>
  );
}

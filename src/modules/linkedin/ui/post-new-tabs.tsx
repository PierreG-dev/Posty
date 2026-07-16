"use client";

import * as React from "react";
import { Tabs } from "@/modules/shared/ui/primitives";
import { PostEditor } from "./post-editor";
import { PostImportPanel } from "./post-import-panel";
import { PostGeneratePanel } from "./post-generate-panel";
import type { Theme } from "@/modules/linkedin/domain/theme";

interface Seed {
  themeId: string;
  content: string;
  hashtags: string[];
  firstComment: string | null;
  altText: string;
}

export function PostNewTabs({ themes }: { themes: Theme[] }) {
  const [tab, setTab] = React.useState<"write" | "generate" | "import">("write");
  const [seed, setSeed] = React.useState<Seed | null>(null);

  function useGenerated(s: Seed) {
    setSeed(s);
    setTab("write");
  }

  return (
    <div className="space-y-6">
      <Tabs
        value={tab}
        onChange={(v) => setTab(v)}
        tabs={[
          { value: "write" as const, label: "Écrire" },
          { value: "generate" as const, label: "Générer" },
          { value: "import" as const, label: "Importer" },
        ]}
      />
      {tab === "write" ? (
        <PostEditor
          mode="create"
          themes={themes}
          seed={seed ?? undefined}
          // key remonte le composant si on charge une nouvelle graine.
          key={seed ? `seed-${seed.content.slice(0, 20)}` : "blank"}
        />
      ) : null}
      {tab === "generate" ? (
        <PostGeneratePanel themes={themes} onUseVariant={useGenerated} />
      ) : null}
      {tab === "import" ? <PostImportPanel themes={themes} /> : null}
    </div>
  );
}

"use client";

import * as React from "react";
import { computePreview, LINKEDIN_TRUNCATE_AT, type PreviewSegment } from "@/modules/linkedin/services/post-preview";
import { cn } from "@/modules/shared/ui/cn";
import { POST_CONTENT_MAX } from "@/modules/linkedin/domain/post";

// Bleu LinkedIn officiel (hashtags cliquables dans le feed).
const LINKEDIN_BLUE = "#0A66C2";

/**
 * Aperçu fidèle LinkedIn : troncature "…voir plus", hashtags en bleu,
 * compteur avec repère de troncature. Composant réutilisable partout
 * (éditeur, aperçu de file, aperçu d'import).
 */
export function LinkedInPostPreview({
  content,
  hashtags,
  firstComment,
  className,
  showCounter = true,
}: {
  content: string;
  hashtags?: string[];
  firstComment?: string | null;
  className?: string;
  showCounter?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);

  // Assemblage : contenu + double saut + hashtags (le format que le publisher enverra).
  const fullText = React.useMemo(() => {
    const hs = hashtags && hashtags.length > 0 ? `\n\n${hashtags.join(" ")}` : "";
    return content + hs;
  }, [content, hashtags]);

  const preview = React.useMemo(() => computePreview(fullText), [fullText]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-xs font-mono text-fg-muted">
            PG
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-fg truncate">Aperçu LinkedIn</p>
            <p className="text-[10px] text-fg-muted">Maintenant · 🌐</p>
          </div>
        </div>

        <div className="text-[13px] leading-[1.45] whitespace-pre-wrap break-words text-fg">
          {expanded || !preview.truncated ? (
            <>{renderSegments([...preview.visible, ...preview.hidden])}</>
          ) : (
            <>
              {renderSegments(preview.visible)}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="text-fg-muted hover:text-fg ml-1 font-medium"
              >
                …voir plus
              </button>
            </>
          )}
        </div>
      </div>

      {firstComment && firstComment.trim() ? (
        <div className="rounded-lg border border-border bg-surface p-3 ml-8 relative">
          <div className="absolute -left-8 top-3 w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-xs font-mono text-fg-muted">
            PG
          </div>
          <p className="text-[11px] text-fg-muted mb-1">Premier commentaire (à coller à la main — cf. spike)</p>
          <p className="text-[13px] leading-[1.45] whitespace-pre-wrap break-words text-fg">
            {renderSegments(tokenizeSimple(firstComment))}
          </p>
        </div>
      ) : null}

      {showCounter ? <Counter preview={preview} /> : null}
    </div>
  );
}

function renderSegments(segments: PreviewSegment[]): React.ReactNode {
  return segments.map((seg, i) =>
    seg.kind === "hashtag" ? (
      <span key={i} style={{ color: LINKEDIN_BLUE }} className="font-medium">
        {seg.text}
      </span>
    ) : (
      <React.Fragment key={i}>{seg.text}</React.Fragment>
    ),
  );
}

function tokenizeSimple(text: string): PreviewSegment[] {
  const out: PreviewSegment[] = [];
  const re = /#[A-Za-z0-9_]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "hashtag", text: m[0] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function Counter({ preview }: { preview: ReturnType<typeof computePreview> }) {
  const { totalLength, truncateAt, truncated } = preview;
  const pct = Math.min(100, Math.round((totalLength / POST_CONTENT_MAX) * 100));
  const overLimit = totalLength > POST_CONTENT_MAX;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className={overLimit ? "text-failed" : "text-fg-muted"}>
          {totalLength} / {POST_CONTENT_MAX}
        </span>
        <span className="text-fg-muted">
          {truncated ? `troncature à ${truncateAt} car.` : "aucune troncature"}
        </span>
      </div>
      <div className="h-1 rounded bg-surface-2 overflow-hidden relative">
        <div
          className={cn("h-full", overLimit ? "bg-failed" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
        {/* Repère du seuil "…voir plus" à ~140 caractères. */}
        <div
          className="absolute top-0 h-full w-px bg-fg-muted/60"
          style={{ left: `${Math.min(100, (LINKEDIN_TRUNCATE_AT / POST_CONTENT_MAX) * 100)}%` }}
          title={`Seuil "…voir plus" ≈ ${LINKEDIN_TRUNCATE_AT} car.`}
        />
      </div>
    </div>
  );
}

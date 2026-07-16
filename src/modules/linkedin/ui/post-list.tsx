"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { Button, Badge, Checkbox, Tabs, EmptyState, Dialog, Select } from "@/modules/shared/ui/primitives";
import { GripVertical, Copy, Pencil, Trash2, Tag, MoreHorizontal, Plus } from "lucide-react";
import type { Post, PostStatus } from "@/modules/linkedin/domain/post";
import type { Theme } from "@/modules/linkedin/domain/theme";
import { computePreview } from "@/modules/linkedin/services/post-preview";

type TabKey = "queued" | "draft" | "scheduled" | "published" | "failed";
const TABS: Array<{ value: TabKey; label: string }> = [
  { value: "queued", label: "File" },
  { value: "draft", label: "Brouillons" },
  { value: "scheduled", label: "Programmés" },
  { value: "published", label: "Publiés" },
  { value: "failed", label: "Échecs" },
];

interface Props {
  initialPosts: Post[];
  initialStatus: TabKey;
  themes: Theme[];
  counts: Record<PostStatus, number>;
}

export function PostList({ initialPosts, initialStatus, themes, counts }: Props) {
  const router = useRouter();
  const [status, setStatus] = React.useState<TabKey>(initialStatus);
  const [themeFilter, setThemeFilter] = React.useState<string>(""); // "" = tous
  const [posts, setPosts] = React.useState<Post[]>(initialPosts);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignTarget, setAssignTarget] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [currentCounts, setCurrentCounts] = React.useState<Record<PostStatus, number>>(counts);

  // Recharge la liste quand l'onglet ou le filtre change.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = new URL("/api/linkedin/posts", window.location.origin);
      url.searchParams.set("status", status);
      url.searchParams.set("counts", "true");
      if (themeFilter) url.searchParams.set("themeId", themeFilter);
      const res = await fetch(url.toString());
      if (!res.ok || cancelled) return;
      const body = (await res.json()) as { posts: Post[]; counts: Record<PostStatus, number> };
      setPosts(body.posts);
      setCurrentCounts(body.counts);
      setSelected(new Set());
    })();
    return () => {
      cancelled = true;
    };
  }, [status, themeFilter]);

  const themeMap = React.useMemo(() => new Map(themes.map((t) => [t._id, t])), [themes]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === posts.length ? new Set() : new Set(posts.map((p) => p._id))));
  }

  async function onDelete(id: string) {
    if (!confirm("Supprimer ce post ?")) return;
    setBusy(true);
    const res = await fetch(`/api/linkedin/posts/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setPosts((p) => p.filter((x) => x._id !== id));
      setCurrentCounts((c) => ({ ...c, [status]: Math.max(0, c[status] - 1) }));
    }
  }

  async function onDuplicate(id: string) {
    setBusy(true);
    const res = await fetch(`/api/linkedin/posts/${id}/duplicate`, { method: "POST" });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function onArchive(id: string) {
    setBusy(true);
    const res = await fetch(`/api/linkedin/posts/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    setBusy(false);
    if (res.ok) {
      setPosts((p) => p.filter((x) => x._id !== id));
      setCurrentCounts((c) => ({ ...c, [status]: Math.max(0, c[status] - 1), archived: c.archived + 1 }));
    }
  }

  async function onAssignTheme(themeId: string | null) {
    // Cible : le lot sélectionné, ou le post en cours si on vient du menu par-ligne.
    const targetIds = assignTarget ? [assignTarget] : [...selected];
    if (targetIds.length === 0) return;
    setBusy(true);
    const res = await fetch("/api/linkedin/posts/bulk-assign-theme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postIds: targetIds, themeId }),
    });
    setBusy(false);
    setAssignOpen(false);
    setAssignTarget(null);
    if (res.ok) router.refresh();
  }

  function openAssignForRow(id: string) {
    setAssignTarget(id);
    setAssignOpen(true);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = posts.findIndex((p) => p._id === active.id);
    const newIndex = posts.findIndex((p) => p._id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(posts, oldIndex, newIndex);
    setPosts(next);

    const res = await fetch("/api/linkedin/posts/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        themeId: themeFilter || null,
        orderedIds: next.map((p) => p._id),
      }),
    });
    if (!res.ok) {
      // Revert on failure.
      setPosts(posts);
      alert("Réordonnancement refusé — la file a bougé entre-temps. Recharge la page.");
    }
  }

  const draggable = status === "queued" && (themeFilter !== "" || themes.length === 1);

  return (
    <div className="space-y-4">
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={TABS.map((t) => ({
          value: t.value,
          label: t.label,
          count: currentCounts[t.value] ?? 0,
        }))}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="font-mono uppercase tracking-wider">Thème :</span>
          <Select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)} className="w-auto">
            <option value="">Tous</option>
            <option value="null">Sans thème</option>
            {themes.map((t) => (
              <option key={t._id} value={t._id}>
                {t.emoji ? `${t.emoji} ` : ""}{t.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 ? (
            <>
              <span className="text-xs text-fg-muted font-mono">{selected.size} sélectionné(s)</span>
              <Button variant="secondary" size="sm" onClick={() => setAssignOpen(true)}>
                <Tag size={14} strokeWidth={1.5} />
                Assigner un thème
              </Button>
            </>
          ) : null}
          <Link href="/linkedin/posts/new">
            <Button variant="primary" size="sm">
              <Plus size={14} strokeWidth={1.5} />
              Nouveau post
            </Button>
          </Link>
        </div>
      </div>

      {status === "queued" && themeFilter === "" && themes.length > 1 ? (
        <p className="text-xs text-fg-muted">
          💡 Sélectionne un thème dans le filtre pour activer le drag & drop de réordonnancement.
        </p>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState
          title={emptyTitle(status)}
          description={emptyDescription(status)}
          action={
            <Link href="/linkedin/posts/new">
              <Button variant="primary" size="sm">Créer / Importer</Button>
            </Link>
          }
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface text-xs font-mono uppercase tracking-wider text-fg-muted">
            <Checkbox checked={selected.size === posts.length && posts.length > 0} onChange={toggleSelectAll} />
            <span className="flex-1">Contenu</span>
            <span className="w-32 shrink-0">Thème</span>
            <span className="w-16 shrink-0 text-right">Car.</span>
            <span className="w-24 shrink-0" />
          </div>

          {draggable ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={posts.map((p) => p._id)} strategy={verticalListSortingStrategy}>
                {posts.map((p) => (
                  <SortableRow
                    key={p._id}
                    post={p}
                    theme={p.themeId ? themeMap.get(p.themeId) : undefined}
                    selected={selected.has(p._id)}
                    onSelect={() => toggleSelect(p._id)}
                    onDelete={() => onDelete(p._id)}
                    onDuplicate={() => onDuplicate(p._id)}
                    onArchive={() => onArchive(p._id)}
                    onChangeTheme={() => openAssignForRow(p._id)}
                    busy={busy}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            posts.map((p) => (
              <Row
                key={p._id}
                post={p}
                theme={p.themeId ? themeMap.get(p.themeId) : undefined}
                selected={selected.has(p._id)}
                onSelect={() => toggleSelect(p._id)}
                onDelete={() => onDelete(p._id)}
                onDuplicate={() => onDuplicate(p._id)}
                onArchive={() => onArchive(p._id)}
                onChangeTheme={() => openAssignForRow(p._id)}
                busy={busy}
              />
            ))
          )}
        </div>
      )}

      <Dialog
        open={assignOpen}
        onClose={() => {
          setAssignOpen(false);
          setAssignTarget(null);
        }}
        title={
          assignTarget
            ? "Changer de thème"
            : `Assigner un thème (${selected.size} post${selected.size > 1 ? "s" : ""})`
        }
        footer={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAssignOpen(false);
              setAssignTarget(null);
            }}
          >
            Annuler
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-fg-muted">Choisis le thème à appliquer, ou « Aucun ».</p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onAssignTheme(null)}
              className="w-full text-left px-3 py-2 rounded hover:bg-surface-2 text-sm border border-border"
            >
              Aucun thème (mettre à null)
            </button>
            {themes.map((t) => (
              <button
                key={t._id}
                type="button"
                onClick={() => onAssignTheme(t._id)}
                className="w-full text-left px-3 py-2 rounded hover:bg-surface-2 text-sm border border-border flex items-center gap-2"
              >
                <span style={{ color: t.color }}>{t.emoji || "◆"}</span>
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function emptyTitle(s: TabKey): string {
  switch (s) {
    case "queued":
      return "Aucun post en file.";
    case "draft":
      return "Aucun brouillon.";
    case "scheduled":
      return "Aucun post programmé.";
    case "published":
      return "Aucun post publié pour l'instant.";
    case "failed":
      return "Aucun échec — 👍";
  }
}
function emptyDescription(s: TabKey): string {
  switch (s) {
    case "queued":
      return "Colle 10 posts d'un coup dans l'onglet « Importer », ou écris-en un.";
    case "draft":
      return "Les brouillons sont les posts non prêts à partir.";
    case "scheduled":
      return "Programmer un post = définir une date de publication précise.";
    case "published":
      return "Les posts publiés apparaîtront ici avec leur lien LinkedIn.";
    case "failed":
      return "Si un post échoue, il sera ici avec le message d'erreur.";
  }
}

function SortableRow(props: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.post._id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative">
      <Row {...props} dragHandle={{ attributes, listeners }} />
    </div>
  );
}

interface RowProps {
  post: Post;
  theme?: Theme;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onChangeTheme: () => void;
  busy: boolean;
  dragHandle?: { attributes: DraggableAttributes; listeners: SyntheticListenerMap | undefined };
}

function Row({ post, theme, selected, onSelect, onDelete, onDuplicate, onArchive, onChangeTheme, dragHandle, busy }: RowProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const preview = computePreview(post.content);
  const firstLine = preview.visible.map((s) => s.text).join("");

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg hover:bg-surface/50 transition-colors">
      {dragHandle ? (
        <button
          type="button"
          {...dragHandle.attributes}
          {...(dragHandle.listeners ?? {})}
          className="text-fg-muted hover:text-fg cursor-grab active:cursor-grabbing shrink-0"
          aria-label="Réordonner"
        >
          <GripVertical size={16} strokeWidth={1.5} />
        </button>
      ) : (
        <div className="w-4 shrink-0" />
      )}
      <Checkbox checked={selected} onChange={onSelect} />
      <div className="flex-1 min-w-0">
        <Link href={`/linkedin/posts/${post._id}`} className="text-sm text-fg hover:text-accent line-clamp-2">
          {firstLine || <span className="italic text-fg-muted">(contenu vide)</span>}
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <StatusBadge status={post.status} />
          {post.source === "sheets-migration" ? <Badge tone="neutral">migré</Badge> : null}
          {post.source === "json-import" ? <Badge tone="neutral">import</Badge> : null}
          {post.firstComment.text ? <Badge tone="neutral">1er commentaire</Badge> : null}
        </div>
      </div>
      <div className="w-32 shrink-0 text-xs truncate">
        {theme ? (
          <span style={{ color: theme.color }}>
            {theme.emoji || "◆"} {theme.name}
          </span>
        ) : (
          <span className="text-fg-muted italic">sans thème</span>
        )}
      </div>
      <div className="w-16 shrink-0 text-right font-mono text-xs text-fg-muted">
        {post.content.length}
      </div>
      <div className="w-24 shrink-0 flex items-center justify-end gap-1 relative">
        <Link href={`/linkedin/posts/${post._id}`}>
          <Button variant="ghost" size="sm" title="Éditer">
            <Pencil size={14} strokeWidth={1.5} />
          </Button>
        </Link>
        <Button variant="ghost" size="sm" onClick={() => setMenuOpen((v) => !v)} title="Plus">
          <MoreHorizontal size={14} strokeWidth={1.5} />
        </Button>
        {menuOpen ? (
          <div className="absolute right-0 top-full mt-1 z-10 w-40 rounded border border-border bg-surface shadow-xl py-1 text-sm">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onDuplicate();
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-surface-2 flex items-center gap-2"
            >
              <Copy size={14} strokeWidth={1.5} /> Dupliquer
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onChangeTheme();
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-surface-2 flex items-center gap-2"
            >
              <Tag size={14} strokeWidth={1.5} /> Changer de thème
            </button>
            {post.status !== "archived" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onArchive();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-surface-2"
              >
                Archiver
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-surface-2 text-failed flex items-center gap-2"
            >
              <Trash2 size={14} strokeWidth={1.5} /> Supprimer
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: PostStatus }) {
  switch (status) {
    case "queued":
      return <Badge tone="queued">En file</Badge>;
    case "draft":
      return <Badge tone="draft">Brouillon</Badge>;
    case "scheduled":
      return <Badge tone="scheduled">Programmé</Badge>;
    case "publishing":
      return <Badge tone="accent">Publication…</Badge>;
    case "published":
      return <Badge tone="published">Publié</Badge>;
    case "failed":
      return <Badge tone="failed">Échec</Badge>;
    case "archived":
      return <Badge tone="neutral">Archivé</Badge>;
  }
}

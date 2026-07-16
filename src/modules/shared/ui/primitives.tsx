"use client";

import * as React from "react";
import { cn } from "./cn";
import { X } from "lucide-react";

// ============================================================================
// Petits primitives Tailwind. Cohérents avec les tokens du design system
// (bg, surface, surface-2, border, fg, fg-muted, accent, statuts). Pas de
// dépendance à shadcn — l'app est trop simple pour en avoir besoin.
// ============================================================================

// --- Button ------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-fg hover:bg-accent/90",
    secondary: "bg-surface-2 text-fg hover:bg-surface-2/70 border border-border",
    ghost: "text-fg hover:bg-surface-2",
    danger: "bg-failed/10 text-failed hover:bg-failed/20 border border-failed/30",
  };
  const sizes: Record<ButtonSize, string> = {
    sm: "text-xs px-2.5 py-1.5",
    md: "text-sm px-3 py-2",
  };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

// --- Input / Textarea --------------------------------------------------------

const fieldBase =
  "block w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-muted outline-none focus:border-accent transition-colors disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "min-h-[100px] resize-y font-sans", className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(fieldBase, "pr-8", className)} {...props}>
        {children}
      </select>
    );
  },
);

// --- Label + Field wrapper ---------------------------------------------------

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-mono uppercase tracking-wider text-fg-muted mb-1.5", className)}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      {label ? <Label>{label}</Label> : null}
      {children}
      {hint && !error ? <p className="text-xs text-fg-muted">{hint}</p> : null}
      {error ? <p className="text-xs text-failed">{error}</p> : null}
    </div>
  );
}

// --- Checkbox ----------------------------------------------------------------

export function Checkbox({
  label,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 cursor-pointer select-none text-sm", className)}>
      <input
        type="checkbox"
        className="w-4 h-4 rounded border-border bg-surface-2 text-accent focus:ring-accent focus:ring-offset-bg accent-accent"
        {...props}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

// --- Badge -------------------------------------------------------------------

type BadgeTone = "neutral" | "accent" | "queued" | "scheduled" | "published" | "failed" | "draft";
const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-fg-muted border-border",
  accent: "bg-accent/15 text-accent border-accent/30",
  queued: "bg-queued/15 text-queued border-queued/30",
  scheduled: "bg-scheduled/15 text-scheduled border-scheduled/30",
  published: "bg-published/15 text-published border-published/30",
  failed: "bg-failed/15 text-failed border-failed/30",
  draft: "bg-draft/15 text-draft border-draft/30",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider font-mono",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// --- Tabs (contrôlé) ---------------------------------------------------------

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: Array<{ value: T; label: React.ReactNode; count?: number; disabled?: boolean }>;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1 border-b border-border", className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.value)}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px transition-colors flex items-center gap-2",
              active
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
              t.disabled && "opacity-40 cursor-not-allowed",
            )}
          >
            <span>{t.label}</span>
            {typeof t.count === "number" ? (
              <span className="text-xs font-mono text-fg-muted">{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// --- Card --------------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-lg border border-border bg-surface", className)}>{children}</div>;
}

// --- Dialog (léger, sans portal) --------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-2 text-fg-muted hover:text-fg"
            aria-label="Fermer"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="px-5 py-3 border-t border-border flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

// --- EmptyState --------------------------------------------------------------

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface p-10 text-center",
        className,
      )}
    >
      <p className="text-sm text-fg">{title}</p>
      {description ? <p className="text-xs text-fg-muted max-w-md">{description}</p> : null}
      {action}
    </div>
  );
}

// --- Alert (info / warning) --------------------------------------------------

type AlertTone = "info" | "warning" | "danger" | "success";
const alertTones: Record<AlertTone, string> = {
  info: "bg-scheduled/10 text-scheduled border-scheduled/30",
  warning: "bg-queued/10 text-queued border-queued/30",
  danger: "bg-failed/10 text-failed border-failed/30",
  success: "bg-published/10 text-published border-published/30",
};

export function Alert({ tone = "info", children, className }: { tone?: AlertTone; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", alertTones[tone], className)}>
      {children}
    </div>
  );
}

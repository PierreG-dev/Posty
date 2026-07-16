import Link from "next/link";
import {
  LayoutDashboard,
  Send,
  Settings,
  Tag,
  PlusCircle,
  History,
  Calendar,
  Users,
  FileText,
  Inbox,
  ListChecks,
  Megaphone,
} from "lucide-react";

const linkedinItems = [
  { href: "/linkedin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/linkedin/posts", label: "Posts", icon: Send },
  { href: "/linkedin/themes", label: "Thèmes", icon: Tag },
  { href: "/linkedin/calendar", label: "Calendrier", icon: Calendar },
  { href: "/linkedin/posts/new", label: "Nouveau post", icon: PlusCircle },
  { href: "/linkedin/history", label: "Historique", icon: History },
];

const mailingItems = [
  { href: "/mailing", label: "Dashboard", icon: LayoutDashboard },
  { href: "/mailing/inbox", label: "Boîte", icon: Inbox },
  { href: "/mailing/queue", label: "File", icon: ListChecks },
  { href: "/mailing/sequence", label: "Séquence", icon: FileText },
  { href: "/mailing/campaigns", label: "Campagnes", icon: Megaphone },
  { href: "/mailing/contacts", label: "Contacts", icon: Users },
  { href: "/mailing/settings", label: "Réglages", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="px-5 py-6 border-b border-border">
        <span className="font-mono text-sm text-fg-muted">posty</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <Section title="LinkedIn">
          {linkedinItems.map((it) => (
            <NavLink key={it.href} href={it.href} icon={it.icon}>
              {it.label}
            </NavLink>
          ))}
        </Section>

        <Section title="Mailing">
          {mailingItems.map((it) => (
            <NavLink key={it.href} href={it.href} icon={it.icon}>
              {it.label}
            </NavLink>
          ))}
        </Section>
      </nav>

      <div className="border-t border-border p-3">
        <NavLink href="/settings" icon={Settings}>
          Réglages
        </NavLink>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 pb-2 text-[11px] uppercase tracking-wider text-fg-muted font-mono">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-fg hover:bg-surface-2 transition-colors"
    >
      <Icon size={16} strokeWidth={1.5} />
      <span>{children}</span>
    </Link>
  );
}

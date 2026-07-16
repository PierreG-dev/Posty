import { Sidebar } from "@/modules/shared/ui/sidebar";
import { requireSession } from "@/modules/shared/auth/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

import { Alert } from "@/modules/shared/ui/primitives";
import { twentyFromEnv, type TwentyCompany } from "@/modules/mailing/twenty";
import { listMetaByIds } from "@/modules/mailing/repositories/company-meta-repo";
import { ContactsList } from "@/modules/mailing/ui/contacts-list";
import type { CompanyMeta } from "@/modules/mailing/domain/company-meta";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const client = twentyFromEnv();
  if (!client) {
    return (
      <div className="p-8">
        <Alert tone="warning">
          Twenty n&apos;est pas configuré. Renseigne <code>TWENTY_API_URL</code> et <code>TWENTY_API_KEY</code> dans l&apos;env.
        </Alert>
      </div>
    );
  }
  let items: TwentyCompany[] = [];
  let error: string | null = null;
  try {
    const r = await client.listCompanies({ limit: 100 });
    items = r.items;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) {
    return (
      <div className="p-8">
        <Alert tone="danger">Erreur Twenty : {error}</Alert>
      </div>
    );
  }

  const metas = await listMetaByIds(items.map((c) => c.id));
  const rows = items.map((c) => ({ ...c, meta: (metas.get(c.id) ?? null) as CompanyMeta | null }));
  return <ContactsList initial={rows} />;
}

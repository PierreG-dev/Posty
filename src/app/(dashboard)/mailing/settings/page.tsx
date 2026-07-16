import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import { env } from "@/modules/shared/env";
import { SettingsEditor } from "@/modules/mailing/ui/settings-editor";

export const dynamic = "force-dynamic";

export default async function MailingSettingsPage() {
  const settings = await getMailSettings();
  const e = env();
  const twentyConfigured = Boolean(e.TWENTY_API_URL && e.TWENTY_API_KEY);
  return <SettingsEditor initialSettings={settings} twentyConfigured={twentyConfigured} />;
}

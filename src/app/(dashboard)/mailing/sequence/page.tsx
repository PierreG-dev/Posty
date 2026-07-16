import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import { listTemplates } from "@/modules/mailing/repositories/mail-templates-repo";
import { listBlocks } from "@/modules/mailing/repositories/mail-blocks-repo";
import { SequenceEditor } from "@/modules/mailing/ui/sequence-editor";

export const dynamic = "force-dynamic";

export default async function SequencePage() {
  const [settings, templates, blocks] = await Promise.all([
    getMailSettings(),
    listTemplates(),
    listBlocks(),
  ]);
  return <SequenceEditor initialSettings={settings} initialTemplates={templates} initialBlocks={blocks} />;
}

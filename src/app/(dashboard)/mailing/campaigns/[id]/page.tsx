import { notFound } from "next/navigation";
import { getCampaign, refreshCampaignStats } from "@/modules/mailing/repositories/campaigns-repo";
import { listBlocks, listBlocksByIds } from "@/modules/mailing/repositories/mail-blocks-repo";
import { getMailSettings } from "@/modules/mailing/repositories/mail-settings-repo";
import { CampaignComposer } from "@/modules/mailing/ui/campaign-composer";
import { CampaignTracker } from "@/modules/mailing/ui/campaign-tracker";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  if (campaign.status === "draft") {
    const [blocks, settings] = await Promise.all([listBlocks(), getMailSettings()]);
    return (
      <CampaignComposer
        campaign={{
          _id: campaign._id,
          name: campaign.name,
          subject: campaign.subject,
          body: campaign.body,
          blockIds: campaign.blockIds,
          targetCompanyIds: campaign.targetCompanyIds,
        }}
        blocks={blocks.map((b) => ({ _id: b._id, name: b.name, kind: b.kind, content: b.content }))}
        settingsHint={{
          dailyCap: settings.dailyCap,
          sendDaysPerWeek: settings.sendDays.length,
        }}
      />
    );
  }

  // Non-draft : rafraîchit les stats et affiche le tracker.
  await refreshCampaignStats(id);
  const fresh = (await getCampaign(id))!;
  const usedBlocks = await listBlocksByIds(fresh.blockIds);
  return (
    <CampaignTracker
      campaign={{
        _id: fresh._id,
        name: fresh.name,
        subject: fresh.subject,
        body: fresh.body,
        blocks: usedBlocks.map((b) => ({ _id: b._id, name: b.name, kind: b.kind, content: b.content })),
        status: fresh.status,
        stats: fresh.stats,
        queuedAt: fresh.queuedAt?.toISOString() ?? null,
        completedAt: fresh.completedAt?.toISOString() ?? null,
        targetCount: fresh.targetCompanyIds.length,
        enqueueReport: fresh.enqueueReport
          ? {
              candidates: fresh.enqueueReport.candidates,
              enqueued: fresh.enqueueReport.enqueued,
              duplicates: fresh.enqueueReport.duplicates,
              noEmail: fresh.enqueueReport.noEmail,
              notFound: fresh.enqueueReport.notFound,
              excluded: fresh.enqueueReport.excluded,
              excludedByReason: fresh.enqueueReport.excludedByReason,
              ineligible: fresh.enqueueReport.ineligible,
              errors: fresh.enqueueReport.errors,
              at: fresh.enqueueReport.at.toISOString(),
            }
          : null,
      }}
    />
  );
}

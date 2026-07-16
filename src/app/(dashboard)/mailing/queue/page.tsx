import { listQueue } from "@/modules/mailing/repositories/mail-queue-repo";
import { QueueClient } from "./QueueClient";

export const dynamic = "force-dynamic";

export default async function MailingQueuePage() {
  // Server component : on charge tous les statuts, le filtre est côté client
  // (petits volumes, une seule requête).
  const entries = await listQueue({
    status: ["pending", "sending", "sent", "failed", "cancelled"],
    limit: 500,
  });
  const serializable = entries.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    sentAt: e.sentAt?.toISOString() ?? null,
    updatedAt: e.updatedAt.toISOString(),
  }));
  return <QueueClient entries={serializable} />;
}

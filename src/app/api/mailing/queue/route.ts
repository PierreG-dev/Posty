import { NextResponse } from "next/server";
import { z } from "zod";
import { listQueue } from "@/modules/mailing/repositories/mail-queue-repo";
import { MAIL_QUEUE_STATUSES, type MailQueueStatus } from "@/modules/mailing/domain/mail-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusSchema = z.enum(MAIL_QUEUE_STATUSES);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  let status: MailQueueStatus | MailQueueStatus[] | undefined;
  if (statusParam) {
    const parts = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
    const parsed = parts.map((p) => statusSchema.safeParse(p));
    if (parsed.some((p) => !p.success)) {
      return NextResponse.json({ error: "status invalide" }, { status: 400 });
    }
    const values = parsed.map((p) => (p as { success: true; data: MailQueueStatus }).data);
    status = values.length === 1 ? values[0] : values;
  }
  const items = await listQueue({ status });
  return NextResponse.json({ items });
}

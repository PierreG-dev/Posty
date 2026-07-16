import { connectDb } from "@/modules/shared/db/mongoose";
import {
  mailTemplateInputSchema,
  type MailTemplate,
  type MailTemplateInput,
  type SequenceStep,
} from "@/modules/mailing/domain/mail-templates";
import { MailTemplateModel, type MailTemplateDoc } from "./mail-templates-model";

type WithTs = MailTemplateDoc & { updatedAt: Date };

function toDomain(doc: WithTs): MailTemplate {
  return {
    _id: String(doc._id),
    step: doc.step as SequenceStep,
    subject: doc.subject,
    body: doc.body,
    blockIds: doc.blockIds.map((id) => String(id)),
    updatedAt: doc.updatedAt,
  };
}

export async function listTemplates(): Promise<MailTemplate[]> {
  await connectDb();
  const docs = await MailTemplateModel.find().sort({ step: 1 }).lean<WithTs[]>();
  return docs.map(toDomain);
}

export async function getTemplateByStep(step: SequenceStep): Promise<MailTemplate | null> {
  await connectDb();
  const doc = await MailTemplateModel.findOne({ step }).lean<WithTs>();
  return doc ? toDomain(doc) : null;
}

/**
 * Upsert par step : la contrainte est « un doc par step ∈ {0,1,2} ». On expose
 * un upsert plutôt qu'un create/update séparés, l'UI édite les 3 en place.
 */
export async function upsertTemplate(input: MailTemplateInput): Promise<MailTemplate> {
  await connectDb();
  const parsed = mailTemplateInputSchema.parse(input);
  const doc = await MailTemplateModel.findOneAndUpdate(
    { step: parsed.step },
    { $set: parsed },
    { new: true, upsert: true },
  ).lean<WithTs>();
  if (!doc) throw new Error("Template introuvable après upsert");
  return toDomain(doc);
}

export async function deleteTemplateByStep(step: SequenceStep): Promise<boolean> {
  await connectDb();
  const r = await MailTemplateModel.deleteOne({ step });
  return r.deletedCount === 1;
}

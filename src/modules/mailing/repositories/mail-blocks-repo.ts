import { Types } from "mongoose";
import { connectDb } from "@/modules/shared/db/mongoose";
import { mailBlockInputSchema, type MailBlock, type MailBlockInput } from "@/modules/mailing/domain/mail-blocks";
import { MailBlockModel, type MailBlockDoc } from "./mail-blocks-model";

type WithTs = MailBlockDoc & { createdAt: Date; updatedAt: Date };

function toDomain(doc: WithTs): MailBlock {
  return {
    _id: String(doc._id),
    name: doc.name,
    kind: doc.kind,
    content: doc.content,
    isDefault: doc.isDefault,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listBlocks(): Promise<MailBlock[]> {
  await connectDb();
  const docs = await MailBlockModel.find().sort({ createdAt: -1 }).lean<WithTs[]>();
  return docs.map(toDomain);
}

export async function listBlocksByIds(ids: readonly string[]): Promise<MailBlock[]> {
  await connectDb();
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return [];
  const docs = await MailBlockModel.find({ _id: { $in: valid } }).lean<WithTs[]>();
  // Préserver l'ordre demandé.
  const byId = new Map(docs.map((d) => [String(d._id), toDomain(d)]));
  const out: MailBlock[] = [];
  for (const id of ids) {
    const b = byId.get(id);
    if (b) out.push(b);
  }
  return out;
}

export async function getBlock(id: string): Promise<MailBlock | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await MailBlockModel.findById(id).lean<WithTs>();
  return doc ? toDomain(doc) : null;
}

export async function createBlock(input: MailBlockInput): Promise<MailBlock> {
  await connectDb();
  const parsed = mailBlockInputSchema.parse(input);
  const created = await MailBlockModel.create(parsed);
  return toDomain(created.toObject() as WithTs);
}

export async function updateBlock(id: string, patch: Partial<MailBlockInput>): Promise<MailBlock | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const parsed = mailBlockInputSchema.partial().parse(patch);
  const doc = await MailBlockModel.findByIdAndUpdate(id, parsed, { new: true }).lean<WithTs>();
  return doc ? toDomain(doc) : null;
}

export async function deleteBlock(id: string): Promise<boolean> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return false;
  const r = await MailBlockModel.deleteOne({ _id: id });
  return r.deletedCount === 1;
}

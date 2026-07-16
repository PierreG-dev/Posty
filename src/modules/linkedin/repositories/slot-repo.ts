import { Types } from "mongoose";
import { connectDb } from "@/modules/shared/db/mongoose";
import { SlotModel, type SlotMongoDoc } from "./slot-model";
import type { Slot, SlotInput, SlotPatch } from "@/modules/linkedin/domain/slot";

function toDomain(doc: SlotMongoDoc): Slot {
  return {
    _id: String(doc._id),
    label: doc.label ?? "",
    dayOfWeek: doc.dayOfWeek,
    time: doc.time,
    themeId: String(doc.themeId),
    modeOverride: doc.modeOverride ?? null,
    active: doc.active,
    createdAt: (doc as SlotMongoDoc & { createdAt: Date }).createdAt,
    updatedAt: (doc as SlotMongoDoc & { updatedAt: Date }).updatedAt,
  };
}

export async function listSlots(opts: { activeOnly?: boolean } = {}): Promise<Slot[]> {
  await connectDb();
  const filter: Record<string, unknown> = {};
  if (opts.activeOnly) filter.active = true;
  const docs = await SlotModel.find(filter).sort({ dayOfWeek: 1, time: 1 }).lean<SlotMongoDoc[]>();
  return docs.map(toDomain);
}

export async function getSlot(id: string): Promise<Slot | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await SlotModel.findById(id).lean<SlotMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function createSlot(input: SlotInput): Promise<Slot> {
  await connectDb();
  const doc = await SlotModel.create({
    ...input,
    themeId: new Types.ObjectId(input.themeId),
  });
  return toDomain(doc.toObject() as SlotMongoDoc);
}

export async function updateSlot(id: string, patch: SlotPatch): Promise<Slot | null> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return null;
  const set: Record<string, unknown> = { ...patch };
  if (typeof patch.themeId === "string" && Types.ObjectId.isValid(patch.themeId)) {
    set.themeId = new Types.ObjectId(patch.themeId);
  }
  const doc = await SlotModel.findByIdAndUpdate(id, { $set: set }, { new: true }).lean<SlotMongoDoc>();
  return doc ? toDomain(doc) : null;
}

export async function deleteSlot(id: string): Promise<boolean> {
  await connectDb();
  if (!Types.ObjectId.isValid(id)) return false;
  const r = await SlotModel.deleteOne({ _id: id });
  return r.deletedCount === 1;
}

import mongoose, { Mongoose } from "mongoose";
import { env } from "@/modules/shared/env";

// Cache global pour survivre au hot-reload dev de Next
// (sinon chaque HMR ouvre une nouvelle connexion et fuit).
type Cached = { conn: Mongoose | null; promise: Promise<Mongoose> | null };
const g = globalThis as unknown as { __mongooseCache?: Cached };
const cache: Cached = g.__mongooseCache ?? { conn: null, promise: null };
g.__mongooseCache = cache;

export async function connectDb(): Promise<Mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    const { MONGODB_URI, MONGODB_DB } = env();
    cache.promise = mongoose.connect(MONGODB_URI, {
      dbName: MONGODB_DB,
      bufferCommands: false,
    });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

export { mongoose };

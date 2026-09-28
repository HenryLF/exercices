import mongoose from 'mongoose';
import { config } from './config.js';

// Cached across warm serverless invocations: one connection per function instance.
let connecting: Promise<typeof mongoose> | null = null;

export function connectDb(uri: string = config.MONGODB_URI): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  connecting ??= mongoose
    .connect(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 5 })
    .catch((err: unknown) => {
      connecting = null; // let the next request retry
      throw err;
    });
  return connecting;
}

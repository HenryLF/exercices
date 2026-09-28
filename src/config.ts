import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  QR_SECRET: z.string().min(32, 'QR_SECRET must be at least 32 characters'),
  BASE_URL: z
    .url('BASE_URL must be a URL such as https://exercices.example.com')
    .transform((u) => u.replace(/\/+$/, '')),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Config = z.infer<typeof EnvSchema>;

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const config = load();
export const isProd = config.NODE_ENV === 'production';

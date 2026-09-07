import { z } from 'zod';

/**
 * Fails fast on boot if the environment is misconfigured — cheaper to
 * catch here than as a 3am mystery on a lab server nobody can SSH into
 * from off-site (design constraint: air-gapped install).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgresql://...)'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  LIVEKIT_URL: z.string().min(1).default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().min(1).default('devkey'),
  LIVEKIT_API_SECRET: z.string().min(1).default('devsecret_devsecret_devsecret'),
  LAB_DATA_ROOT: z.string().min(1).default('./LabData'),
  WEB_DIST_PATH: z.string().min(1).default('../web/dist'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

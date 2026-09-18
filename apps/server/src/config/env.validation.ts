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
  // Phase 5 — electron-updater's generic-provider feed (LAN auto-update,
  // design doc §3.8). A real deployment drops each new release's
  // `latest.yml` + installer here; empty is fine (electron-updater just
  // 404s harmlessly on its periodic check, same degrade-honestly posture
  // as every other optional-dependency gap in this codebase).
  UPDATES_DIR: z.string().min(1).default('./updates'),
  // Phase 5 — admin-triggered backup (infra/backup/backup.ps1, also
  // schedulable directly via Task Scheduler independent of this server).
  BACKUP_SCRIPT_PATH: z.string().min(1).default('../../infra/backup/backup.ps1'),
  BACKUP_ROOT: z.string().min(1).default('./backups'),
  PG_BIN_DIR: z.string().min(1).default('C:\\Program Files\\PostgreSQL\\16\\bin'),
  // Phase 3 — upload/body limits (main.ts's Express JSON parser and every
  // multer FileInterceptor read these; unbounded uploads is how a single
  // media-library video takes down the process on an air-gapped box with
  // no ops team to page).
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  MAX_JSON_BODY_KB: z.coerce.number().int().positive().default(2048),
  // Phase 3 — offline speech pipeline (design doc "Speech (offline)").
  // Both are optional: absent means the pronunciation pipeline degrades
  // to "record only, no IPA/model audio" rather than failing to boot —
  // same honesty pattern as native-bridge's input-lock stub.
  ESPEAK_NG_BIN: z.string().min(1).optional(),
  ESPEAK_NG_DATA: z.string().min(1).optional(),  // data dir for portable (non-installed) eSpeak-NG
  PIPER_BIN: z.string().min(1).optional(),
  PIPER_VOICES_DIR: z.string().min(1).optional(),
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

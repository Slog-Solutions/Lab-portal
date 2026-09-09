import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { EnvConfig } from '../../config/env.validation';

/**
 * Phase 5 — the manual-trigger half of backup/restore
 * (`infra/backup/README.md`'s "Manual trigger" section). The real backup
 * logic lives in one place, `infra/backup/backup.ps1` (also independently
 * schedulable via Task Scheduler) — this just invokes it with the same
 * connection details the running server already trusts (`DATABASE_URL`,
 * `LAB_DATA_ROOT`), so a manual admin-triggered backup and a scheduled
 * one can never quietly drift onto different databases.
 *
 * Restore is deliberately NOT exposed here — `restore.ps1` is destructive
 * (`--clean` drops every object in the target database first) and the
 * build plan's own security posture ("no run-arbitrary-command verb", the
 * same principle behind `lab-agent-svc`'s closed verb set) argues against
 * a REST endpoint whose entire job is "irreversibly destroy the current
 * database" — that stays a deliberate, local, `-Confirm`-gated console
 * operation.
 */
@Injectable()
export class AdminService {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  async runBackup(): Promise<{ output: string }> {
    const dbUrl = new URL(this.config.get('DATABASE_URL', { infer: true }));
    const scriptPath = path.resolve(process.cwd(), this.config.get('BACKUP_SCRIPT_PATH', { infer: true }));

    const args = [
      '-NoProfile',
      '-File',
      scriptPath,
      '-BackupRoot',
      this.config.get('BACKUP_ROOT', { infer: true }),
      '-PgBinDir',
      this.config.get('PG_BIN_DIR', { infer: true }),
      '-DbHost',
      dbUrl.hostname,
      '-DbPort',
      dbUrl.port || '5432',
      '-DbName',
      dbUrl.pathname.replace(/^\//, ''),
      '-DbUser',
      decodeURIComponent(dbUrl.username),
      '-DbPassword',
      decodeURIComponent(dbUrl.password),
      '-LabDataRoot',
      path.resolve(process.cwd(), this.config.get('LAB_DATA_ROOT', { infer: true })),
    ];

    return new Promise((resolve, reject) => {
      execFile('powershell.exe', args, { timeout: 5 * 60_000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new InternalServerErrorException(`Backup failed: ${stderr || err.message}`));
          return;
        }
        resolve({ output: stdout });
      });
    });
  }
}

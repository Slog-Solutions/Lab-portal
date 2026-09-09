import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RecordingKind } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { EnvConfig } from '../../config/env.validation';

export interface CreateRecordingParams {
  kind: RecordingKind;
  sessionId?: string;
  activityInstanceId?: string;
  attemptId?: string;
  stationId?: string;
  studentIds?: string[];
}

/**
 * Client-side recording (design doc §2.6 — Egress is Docker/Linux-only,
 * so every Phase 2 activity records by uploading from the browser/
 * Electron renderer instead). The Recording row is created BEFORE
 * capture starts and reconciled on upload completion — never derived by
 * parsing a filename, per the design's own rule.
 */
@Injectable()
export class RecordingsService {
  private readonly dataRoot: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {
    this.dataRoot = this.config.get('LAB_DATA_ROOT', { infer: true });
  }

  async createPending(params: CreateRecordingParams) {
    return this.prisma.recording.create({
      data: {
        kind: params.kind,
        sessionId: params.sessionId,
        activityInstanceId: params.activityInstanceId,
        attemptId: params.attemptId,
        stationId: params.stationId,
        studentIds: params.studentIds ?? [],
        status: 'pending',
      },
    });
  }

  async get(id: string) {
    const recording = await this.prisma.recording.findUnique({ where: { id } });
    if (!recording) throw new NotFoundException('Recording not found');
    return recording;
  }

  async listForActivity(activityInstanceId: string) {
    return this.prisma.recording.findMany({ where: { activityInstanceId }, orderBy: { createdAt: 'asc' } });
  }

  /** Moves the uploaded temp file into permanent storage under
   * LAB_DATA_ROOT/recordings/<id><ext> and marks the row ready. Never
   * trusts the client's claimed duration — that's read back client-side
   * for now (Phase 2 scope); server-side ffmpeg probing is a hardening
   * item, not required for the activities themselves to function. */
  async finalizeUpload(id: string, tempFilePath: string, originalName: string, durationMs?: number) {
    const recording = await this.get(id);
    const ext = path.extname(originalName) || '.webm';
    const recordingsDir = path.join(this.dataRoot, 'recordings');
    await mkdir(recordingsDir, { recursive: true });
    const destPath = path.join(recordingsDir, `${id}${ext}`);
    await rename(tempFilePath, destPath);
    const { size } = await stat(destPath);

    return this.prisma.recording.update({
      where: { id: recording.id },
      data: {
        path: destPath,
        sizeBytes: size,
        durationMs,
        status: 'ready',
        finalizedAt: new Date(),
      },
    });
  }

  resolveFilePath(recording: { path: string | null }): string {
    if (!recording.path) throw new NotFoundException('Recording has no file yet');
    return recording.path;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Every privileged action — screen viewed, remote control started, station
 * shut down, score edited — MUST go through this service. This is what
 * makes the remote-control agent (design doc §3.6) auditable rather than
 * just a bare backdoor: "built as one" means every use is logged with the
 * actor's identity.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    actorId?: string | null;
    stationId?: string | null;
    action: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: params.actorId ?? null,
          stationId: params.stationId ?? null,
          action: params.action,
          detail: (params.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      // Audit logging must never take down the request that triggered it,
      // but a failure here is itself significant — surface it loudly.
      this.logger.error(`Failed to write audit log for action=${params.action}`, err as Error);
    }
  }
}

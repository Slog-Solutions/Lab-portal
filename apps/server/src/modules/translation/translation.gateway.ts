import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { CONTROL_NAMESPACE } from '@lab/shared/events';
import { zSetListenLanguageDto } from '@lab/shared';
import type { JwtPayload } from '../auth/auth.service';
import { TranslationService } from './translation.service';

interface AuthedSocket extends Socket {
  data: { auth?: { kind: 'station'; stationId: string } | { kind: 'user'; user: JwtPayload } };
}

/**
 * The translation half of the /control namespace. Shares the namespace —
 * and therefore `socket.data.auth`, which ControlGateway sets on
 * connect/hello — with ControlGateway, but lives in its own module so
 * TranslationService can depend on ControlGateway without a cycle. Same
 * arrangement as RoundTableGateway.
 *
 * Security: the seat is ALWAYS `socket.data.auth.stationId`, never
 * anything in the payload. The language itself is re-validated against
 * the admin-enabled list inside TranslationService — a station could
 * otherwise ask for a language an admin has switched off, which would
 * spend a GPU stream nobody authorised.
 */
@WebSocketGateway({ namespace: CONTROL_NAMESPACE, cors: { origin: true, credentials: true } })
export class TranslationGateway {
  private readonly logger = new Logger(TranslationGateway.name);

  constructor(private readonly translation: TranslationService) {}

  @SubscribeMessage('translation:setLanguage')
  async setLanguage(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<void> {
    const auth = socket.data.auth;
    if (auth?.kind !== 'station') return;
    const parsed = zSetListenLanguageDto.safeParse(body);
    if (!parsed.success) return;
    try {
      await this.translation.setListenLanguage(auth.stationId, parsed.data.lang);
    } catch (err) {
      // Never surfaced to the station as an error: the next snapshot
      // carries the authoritative selection, so a failure here just means
      // the student's choice did not take, which the UI already shows.
      this.logger.warn(`translation:setLanguage failed for ${auth.stationId}: ${(err as Error).message}`);
    }
  }
}

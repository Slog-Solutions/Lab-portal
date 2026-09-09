import { Controller, Post } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import { BROADCAST_ROOM } from '@lab/shared/events';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { MediaService } from './media.service';

/**
 * Token issuance for JWT-authenticated dashboard users (teacher/admin),
 * as distinct from stations (which get their media grants inside
 * DesiredStationState via SessionStateService, keyed by machineGuid
 * identity, not a user JWT). The teacher's web console is a user, not a
 * station, so it needs its own mint path — design doc §2.5: "Never mint
 * tokens client-side."
 */
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Publish rights on lab:broadcast — this is what lets the teacher
   * console actually start a screen/mic broadcast to the whole class. */
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post('broadcast-token')
  async broadcastToken(@CurrentUser() user: JwtPayload) {
    await this.media.ensureBroadcastRoom();
    // mintToken's `stationId` param becomes the LiveKit participant
    // identity verbatim (`st:${stationId}`) — reused here for a
    // non-station identity too since it's just an opaque LiveKit
    // identity string, not literally a Station row lookup.
    const token = await this.media.mintToken({
      stationId: `teacher:${user.sub}`,
      displayName: `Teacher (${user.serviceNumber})`,
      room: BROADCAST_ROOM,
      role: 'TEACHER',
    });
    return { room: BROADCAST_ROOM, token };
  }
}

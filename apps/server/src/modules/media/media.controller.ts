import { ConflictException, Controller, Post } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import { BROADCAST_ROOM, classBroadcastRoom } from '@lab/shared/events';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { ClassAccessService } from '../classroom/class-access.service';
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
  constructor(
    private readonly media: MediaService,
    private readonly classAccess: ClassAccessService,
  ) {}

  /**
   * ADMIN keeps the lab-wide lab:broadcast room (unchanged). A TEACHER
   * broadcasts only to their own active class — the class-scoped room
   * SessionStateService already grants every signed-in student in that
   * class (STUDENT role, subscribe + mic-only) — so a teacher with no
   * active class has no room to broadcast into at all.
   */
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Post('broadcast-token')
  async broadcastToken(@CurrentUser() user: JwtPayload) {
    if (user.role === UserRole.ADMIN) {
      await this.media.ensureBroadcastRoom();
      const token = await this.media.mintToken({
        stationId: `teacher:${user.sub}`,
        displayName: `Teacher (${user.serviceNumber})`,
        room: BROADCAST_ROOM,
        role: 'TEACHER',
      });
      return { room: BROADCAST_ROOM, token };
    }

    const activeClass = await this.classAccess.activeClassForTeacher(user.sub);
    if (!activeClass) {
      throw new ConflictException('Start a class before broadcasting');
    }
    const room = classBroadcastRoom(activeClass.id);
    await this.media.ensureRoom(room);
    const token = await this.media.mintToken({
      stationId: `teacher:${user.sub}`,
      displayName: `Teacher (${user.serviceNumber})`,
      room,
      role: 'TEACHER',
    });
    return { room, token };
  }
}

import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { extname } from 'node:path';
import { UserRole, zImportContentPackageDto } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { ContentPackagesService } from './content-packages.service';

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * SCORM/xAPI/HTML import + serving (Ser 4 "launch web/HTML content").
 * Upload/list/metadata are TEACHER/ADMIN (authoring); the launch route
 * (`:id/files/*`) accepts ANY authenticated principal — a station running
 * the exercise as a student needs it too, and access control on *whether*
 * this student should see this exercise lives at the Exercise/Attempt
 * layer, not here.
 */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('content-packages')
export class ContentPackagesController {
  constructor(private readonly packages: ContentPackagesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(zImportContentPackageDto)) dto: ReturnType<typeof zImportContentPackageDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('No file uploaded (expected a .zip for SCORM/xAPI, or a single .html file)');
    return this.packages.import(user.sub, dto, { tempPath: file.path, originalName: file.originalname });
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.packages.list({ id: user.sub, role: user.role });
  }

  /** Metadata (title/entryPoint/format) — any authenticated principal, not
   * just TEACHER/ADMIN: a station needs entryPoint to build the player's
   * iframe src. Unlike the file-serving route below, this one IS reached
   * with a normal fetch() (not an <iframe src>), so a station's own
   * bearer token works fine here — no need for @Public(). */
  @Roles()
  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.packages.get(id, { id: user.sub, role: user.role });
  }

  /**
   * Launch route — deliberately @Public(), not just "any authenticated
   * principal": a player mounts a package's entry point in an <iframe
   * src="...">, and a plain iframe navigation cannot carry an
   * Authorization header (no hook exists to attach one to a browser-
   * initiated GET). Content packages are shared teaching material scoped
   * PRIVATE/DEPARTMENT/INSTITUTION for *authoring* visibility, not
   * per-student secrets the way a score or a recording is — same
   * trade-off class as RecordingsController's original gap, but lower
   * stakes, so accepted here rather than building a signed-URL scheme.
   * Multi-segment assets (a package's own relative <script>/<link>
   * references) need a real wildcard, not one encoded path segment —
   * Express 5's path-to-regexp@8 gives a *named* splat, so
   * req.params.path is an array of segments here, not a string (verified
   * against the real installed express@5.2.1, not assumed from older
   * Express docs).
   */
  @Public()
  @Get(':id/files/*path')
  async getFile(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const pkg = await this.packages.getForLaunch(id);
    const segments = (req.params as unknown as { path?: string[] }).path ?? [];
    const relative = segments.join('/');
    const absolutePath = this.packages.resolveAssetPath(pkg, relative);
    const mimeType = MIME_BY_EXT[extname(absolutePath).toLowerCase()] ?? 'application/octet-stream';
    res.set('Content-Type', mimeType);
    res.sendFile(absolutePath);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.packages.remove(id, { id: user.sub, role: user.role });
    return { ok: true };
  }
}

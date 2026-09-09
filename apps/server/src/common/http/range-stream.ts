import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';

/**
 * Range-request file streaming (RFC 7233) — the gap Phase 2's recording
 * playback left open (whole-file StreamableFile only, no 206/seeking).
 * Media-library assets and long recordings both need scrubbing, which a
 * <video>/<audio> element only gets by the browser issuing `Range:
 * bytes=N-` requests and the server honoring them with 206 + Content-Range.
 * Without this, seeking in a long master track re-downloads from byte 0.
 */
export function streamFileWithRange(req: Request, res: Response, absolutePath: string, mimeType: string): void {
  if (!existsSync(absolutePath)) throw new NotFoundException('File missing on disk');
  const { size } = statSync(absolutePath);
  const range = req.headers.range;

  if (!range) {
    res.status(200).set({
      'Content-Type': mimeType,
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(absolutePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).set({ 'Content-Range': `bytes */${size}` }).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
    res.status(416).set({ 'Content-Range': `bytes */${size}` }).end();
    return;
  }

  res.status(206).set({
    'Content-Type': mimeType,
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
  });
  createReadStream(absolutePath, { start, end }).pipe(res);
}

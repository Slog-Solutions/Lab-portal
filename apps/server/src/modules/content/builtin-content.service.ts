import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ActivityType, ContentPackageFormat, MediaAssetScope } from '@lab/shared';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { PronunciationService } from '../pronunciation/pronunciation.service';

export const BUILTIN_PUBLISHER = 'Lab Portal (ready-made, original)';
const NARRATION_FILE = 'narration.wav';

interface PackQuestion {
  id: string;
  type: 'choice' | 'text';
  prompt: string;
  choices?: string[];
  answer: string | string[];
}

interface PackDefinition {
  title: string;
  gradeLevel: string;
  cefrLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  description: string;
  image: { file: string; caption: string };
  sections: Array<{ heading?: string; paragraphs: string[] }>;
  glossary: Array<[string, string]>;
  questions: PackQuestion[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The pack as one self-contained HTML page (Ser 4 "Content should be HTML
 * format"): text, image and narration audio, then its questions, marked by
 * lab-exercise.js and reported through the SCORM API. */
export function renderPackHtml(pack: PackDefinition, hasNarration: boolean): string {
  const sections = pack.sections
    .map((s) => `${s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : ''}${s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}`)
    .join('\n');
  const glossary = pack.glossary.map(([w, m]) => `<li><strong>${escapeHtml(w)}</strong> — ${escapeHtml(m)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pack.title)}</title>
<link rel="stylesheet" href="lab-exercise.css">
</head>
<body>
<main>
<header><p class="meta">${escapeHtml(pack.gradeLevel)} · CEFR ${escapeHtml(pack.cefrLevel)}</p><h1>${escapeHtml(pack.title)}</h1></header>
${hasNarration ? `<div class="listen"><span>Listen to the article:</span><audio controls preload="none" src="${NARRATION_FILE}"></audio></div>` : ''}
<figure><img src="${escapeHtml(pack.image.file)}" alt="${escapeHtml(pack.image.caption)}"><figcaption>${escapeHtml(pack.image.caption)}</figcaption></figure>
<article>
${sections}
</article>
<h2>Word box</h2>
<ul class="glossary">${glossary}</ul>
<h2>Questions</h2>
<form id="questions" onsubmit="return false"></form>
<p><button id="submit" type="button">Check my answers</button></p>
<p id="result" role="status"></p>
</main>
<script src="exercise-data.js"></script>
<script src="lab-exercise.js"></script>
</body>
</html>
`;
}

/**
 * Ser 4 "readymade ... content ... integrated in the language lab software
 * and level wise": the packs in apps/server/content-packs are installed
 * into LabData on start-up, registered as ContentPackage rows (no owner,
 * `builtinKey`) and each gets a ready-to-assign CONTENT_EXERCISE (no
 * teacher, `catalogKey` "content:<pack>"). Narration audio is produced by
 * the offline Piper voice the first time, in the background; until then
 * (or on a server without Piper) the page simply has no audio player.
 */
@Injectable()
export class BuiltinContentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BuiltinContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pronunciation: PronunciationService,
  ) {}

  onApplicationBootstrap(): void {
    // Never hold up start-up (or fail it) over sample content.
    void this.sync().catch((err: Error) => this.logger.warn(`Ready-made content not installed: ${err.message}`));
  }

  private sourceRoot(): string | null {
    const candidates = [path.resolve(process.cwd(), 'content-packs'), path.resolve(__dirname, '../../../content-packs'), path.resolve(__dirname, '../../../../content-packs')];
    return candidates.find((c) => existsSync(c)) ?? null;
  }

  async sync(): Promise<void> {
    const root = this.sourceRoot();
    if (!root) {
      this.logger.warn('content-packs folder not found — no ready-made content installed');
      return;
    }
    const runtime = path.join(root, '_runtime');
    const slugs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);
    const needsNarration: Array<{ slug: string; pack: PackDefinition; dest: string }> = [];

    for (const slug of slugs) {
      const src = path.join(root, slug);
      const pack = JSON.parse(await readFile(path.join(src, 'pack.json'), 'utf8')) as PackDefinition;
      const relative = path.posix.join('content', 'builtin', slug);
      const dest = this.storage.resolve(relative);
      await mkdir(dest, { recursive: true });
      for (const dir of [runtime, src]) {
        for (const file of await readdir(dir)) {
          if (file !== 'pack.json') await copyFile(path.join(dir, file), path.join(dest, file));
        }
      }
      const hasNarration = existsSync(path.join(dest, NARRATION_FILE));
      await writeFile(path.join(dest, 'index.html'), renderPackHtml(pack, hasNarration));
      // A file, not an inline <script>: no inline code needed at all. The
      // answers are in it — this is practice content marked on the seat,
      // exactly like a publisher's HTML/SCORM package; the lab keeps what it reports.
      await writeFile(path.join(dest, 'exercise-data.js'), `window.LAB_EXERCISE = ${JSON.stringify({ questions: pack.questions })};\n`);
      if (!hasNarration) needsNarration.push({ slug, pack, dest });

      const fields = {
        title: pack.title,
        publisher: BUILTIN_PUBLISHER,
        gradeLevel: pack.gradeLevel,
        cefrLevel: pack.cefrLevel,
        description: pack.description,
        format: ContentPackageFormat.HTML,
        entryPoint: 'index.html',
        path: relative,
        scope: MediaAssetScope.INSTITUTION,
      };
      const saved = await this.prisma.contentPackage.upsert({
        where: { builtinKey: slug },
        create: { ...fields, builtinKey: slug },
        update: fields,
        select: { id: true },
      });
      const config = { contentPackageId: saved.id, gradeLevel: pack.gradeLevel, cefrLevel: pack.cefrLevel } as Prisma.InputJsonValue;
      await this.prisma.exercise.upsert({
        where: { catalogKey: `content:${slug}` },
        create: { type: ActivityType.CONTENT_EXERCISE, title: pack.title, catalogKey: `content:${slug}`, config },
        update: { title: pack.title, config },
      });
    }

    for (const { slug, pack, dest } of needsNarration) {
      const text = [pack.title, ...pack.sections.flatMap((s) => [s.heading ?? '', ...s.paragraphs])].filter(Boolean).join('\n\n');
      try {
        const wav = await this.pronunciation.generateModelAudio(text, 'en_GB');
        await writeFile(path.join(dest, NARRATION_FILE), wav);
        await writeFile(path.join(dest, 'index.html'), renderPackHtml(pack, true));
        this.logger.log(`Ready-made content: narration generated for "${slug}"`);
      } catch (err) {
        this.logger.warn(`No narration for "${slug}" (offline voice unavailable?): ${(err as Error).message}`);
      }
    }
  }
}

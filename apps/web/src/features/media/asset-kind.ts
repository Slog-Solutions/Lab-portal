import { AssetKind } from '@lab/shared';

/** The library's `kind` is a coarse bucket; anything that isn't audio, video
 * or an image (PDFs, Word/PowerPoint files, ...) is a "text" source document. */
export function assetKindOf(file: File): AssetKind {
  if (file.type.startsWith('audio/')) return AssetKind.AUDIO;
  if (file.type.startsWith('video/')) return AssetKind.VIDEO;
  if (file.type.startsWith('image/')) return AssetKind.IMAGE;
  return AssetKind.TEXT;
}

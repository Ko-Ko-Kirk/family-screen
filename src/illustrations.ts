export type ReadingIllustration = {
  file: string; before_cue: number; width: number; height: number; alt: string; decorative: boolean;
};
export type ReadingIllustrations = { version: 1; caption_sha256: string | null; images: ReadingIllustration[] };
export const illustrationFile = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/;

/** Only inert raster assets and explicit caption anchors can enter the reader. */
export function parseIllustrations(value: unknown): ReadingIllustrations | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.images) || v.images.length > 200) return null;
  if (typeof v.caption_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.caption_sha256)) {
    return v.caption_sha256 === null && v.images.length === 0 ? { version: 1, caption_sha256: null, images: [] } : null;
  }
  const images: ReadingIllustration[] = [];
  let previous = -1;
  for (const item of v.images) {
    if (!item || typeof item !== 'object') return null;
    const i = item as Record<string, unknown>;
    if (typeof i.file !== 'string' || !illustrationFile.test(i.file)
      || !Number.isInteger(i.before_cue) || (i.before_cue as number) < previous || (i.before_cue as number) < 0 || (i.before_cue as number) > 100000
      || !Number.isInteger(i.width) || (i.width as number) < 1 || (i.width as number) > 20000
      || !Number.isInteger(i.height) || (i.height as number) < 1 || (i.height as number) > 20000
      || typeof i.alt !== 'string' || i.alt.length > 1000 || typeof i.decorative !== 'boolean') return null;
    previous = i.before_cue as number;
    images.push({file:i.file,before_cue:previous,width:i.width as number,height:i.height as number,alt:i.alt,decorative:i.decorative});
  }
  return {version:1,caption_sha256:v.caption_sha256,images};
}

export function matchingIllustrations(value: unknown, captionHash: string, cueCount: number): ReadingIllustration[] | null {
  const manifest = parseIllustrations(value);
  if (!manifest || manifest.images.length && (manifest.caption_sha256 !== captionHash || manifest.images.some(i=>i.before_cue>cueCount))) return null;
  return manifest.images;
}

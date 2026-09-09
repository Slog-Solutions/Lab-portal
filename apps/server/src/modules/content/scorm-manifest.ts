import { XMLParser } from 'fast-xml-parser';
import { ContentPackageFormat, type ContentPackageFormat as ContentPackageFormatType } from '@lab/shared';

export interface ParsedManifest {
  format: ContentPackageFormatType;
  entryPoint: string; // href of the launch file, relative to the package root
  title?: string;
}

/**
 * SCORM 1.2 / 2004 imsmanifest.xml parsing — the "import" half of the
 * build plan's "engine + SCORM/xAPI import + original seed pack" decision.
 * Scope: resolves the launchable file so the package can be served and
 * opened; it does NOT implement a full SCORM RTE (LMSGetValue/SetValue
 * server-side data model) — that bridge is a client-side shim in
 * ContentExercisePlayer (window.API / window.API_1484_11), which is where
 * a package's own JS actually calls it, per the standard SCORM
 * `findAPI()` walk-up-the-parent-chain convention. Server's job here ends
 * at "which file do I launch, and what SCORM version is it."
 */
export function parseScormManifest(xml: string): ParsedManifest {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const manifest = doc.manifest as Record<string, unknown> | undefined;
  if (!manifest) throw new Error('imsmanifest.xml has no <manifest> root element');

  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  const schemaVersion = (metadata?.schemaversion as string | undefined) ?? (manifest['@_version'] as string | undefined);
  const format: ContentPackageFormatType = String(schemaVersion ?? '').trim().startsWith('2004')
    ? ContentPackageFormat.SCORM2004
    : ContentPackageFormat.SCORM12;

  const organizations = manifest.organizations as Record<string, unknown> | undefined;
  const defaultOrgId = organizations?.['@_default'] as string | undefined;
  const orgList = toArray<Record<string, unknown>>(organizations?.organization);
  const org = orgList.find((o) => o['@_identifier'] === defaultOrgId) ?? orgList[0];
  if (!org) throw new Error('imsmanifest.xml has no <organization> to launch');

  const firstItem = toArray<Record<string, unknown>>(org.item)[0];
  const identifierRef = firstItem?.['@_identifierref'] as string | undefined;
  if (!identifierRef) throw new Error('imsmanifest.xml\'s first <item> has no identifierref to resolve a launch resource');

  const resources = manifest.resources as Record<string, unknown> | undefined;
  const resourceList = toArray<Record<string, unknown>>(resources?.resource);
  const resource = resourceList.find((r) => r['@_identifier'] === identifierRef);
  const href = resource?.['@_href'] as string | undefined;
  if (!href) throw new Error(`imsmanifest.xml's resource "${identifierRef}" has no href to launch`);

  const rawTitle = org.title;
  const title = typeof rawTitle === 'string' ? rawTitle : undefined;

  return { format, entryPoint: href, title };
}

function toArray<T>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}

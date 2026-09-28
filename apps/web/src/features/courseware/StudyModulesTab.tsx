import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityType, MediaAssetScope } from '@lab/shared';
import { exercisesApi } from '../../lib/exercises-api';
import { mediaAssetsApi, type MediaAsset } from '../../lib/media-assets-api';
import { studyModulesApi, type StudyMaterial, type StudyModule } from '../../lib/study-modules-api';
import { queryKeys } from '../../lib/query-keys';
import { AssetPreviewDialog } from '../media/AssetPreviewDialog';
import { assetKindOf } from '../media/asset-kind';
import { LibraryFilePicker } from './LibraryFilePicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/**
 * Ser 1 "content management library... self-study even when teacher not
 * present" / Ser 10 "CEFR-aligned worksheets across 4 key skills". A
 * StudyModule is a named, ordered bundle of already-authored exercises
 * (built on the Exercises page) — this page only curates which exercises
 * belong to which module; the exercises themselves keep their own
 * authoring flow (word-list import, item bank, pronunciation text, ...).
 * A module can also carry files (worksheets, PDFs, audio, video, images) that
 * students open from their own console — either uploaded straight to the
 * module, or picked from the Files tab ("Add from library"). Uploaded ones are
 * stored as INSTITUTION-scope media assets, because a student seat reads them
 * with its station token and could never open a PRIVATE one.
 *
 * This is the "Study Modules" tab of the merged Study Library page.
 */

function uploadMaterial(file: File): Promise<string> {
  return mediaAssetsApi
    .upload(file, { kind: assetKindOf(file), title: file.name, scope: MediaAssetScope.INSTITUTION })
    .then((asset) => asset.id);
}

/** Mirrors zCreateStudyModuleDto's description limit. */
const DESCRIPTION_MAX = 2000;

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function StudyModulesTab() {
  const queryClient = useQueryClient();
  const { data: modules, isLoading } = useQuery({ queryKey: queryKeys.studyModules, queryFn: studyModulesApi.list });
  const { data: allExercises } = useQuery({ queryKey: queryKeys.exercises, queryFn: exercisesApi.list });
  // A one-shot test (see AttemptsService.ONE_SHOT_TYPES) can only be started
  // from its own Assignment — AttemptsService.assertTestStartable requires
  // one — so none of them have a place in an open self-study library.
  const ONE_SHOT_TYPES: string[] = [ActivityType.PRONUNCIATION_TEST, ActivityType.WRITING_TEST, ActivityType.LISTENING_TEST, ActivityType.READING_TEST];
  const exercises = allExercises?.filter((ex) => !ONE_SHOT_TYPES.includes(ex.type));

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<File[]>([]);
  // Files picked from the Files tab rather than uploaded here.
  const [libraryFiles, setLibraryFiles] = useState<MediaAsset[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed create can be retried, so files that already uploaded are
  // remembered and not sent (and duplicated in the Media Library) again.
  const uploadedIds = useRef(new Map<File, string>());
  const fileInput = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: async () => {
      const materialAssetIds: string[] = libraryFiles.map((a) => a.id);
      for (const file of files) {
        let id = uploadedIds.current.get(file);
        if (!id) {
          id = await uploadMaterial(file);
          uploadedIds.current.set(file, id);
        }
        materialAssetIds.push(id);
      }
      return studyModulesApi.create({ title, description: description.trim() || undefined, exerciseIds: Array.from(selected), materialAssetIds });
    },
    onSuccess: () => {
      setOpen(false);
      setTitle('');
      setDescription('');
      setSelected(new Set());
      setFiles([]);
      setLibraryFiles([]);
      uploadedIds.current.clear();
      void queryClient.invalidateQueries({ queryKey: queryKeys.studyModules });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create study module'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => studyModulesApi.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.studyModules }),
  });

  function toggle(exerciseId: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
  }

  function addFiles(picked: FileList | null): void {
    if (!picked) return;
    // Copy first: `picked` is the input's live FileList, emptied by the reset below.
    const added = Array.from(picked);
    setFiles((prev) => [...prev, ...added]);
    // Reset so picking the same file again after removing it still fires onChange.
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Curated exercise bundles and files students can browse and practise from at any time — no session or teacher required.
        </p>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setError(null);
          }}
        >
          <DialogTrigger asChild>
            <Button>New Study Module</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Study Module</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. A2 Grammar Foundations" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={DESCRIPTION_MAX}
                  rows={3}
                  placeholder="Guide your students: what to read or listen to first, what to practise, how long to spend, what to aim for…"
                />
                <p className="text-right text-xs text-muted-foreground">
                  {description.length}/{DESCRIPTION_MAX}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Exercises</Label>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {exercises?.map((ex) => (
                    <label key={ex.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50">
                      <Checkbox checked={selected.has(ex.id)} onCheckedChange={() => toggle(ex.id)} />
                      <span className="flex-1">{ex.title}</span>
                      <Badge variant="outline">{ex.type}</Badge>
                    </label>
                  ))}
                  {exercises?.length === 0 && <p className="p-1.5 text-xs text-muted-foreground">No exercises authored yet — create one on the Exercises page first.</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Files</Label>
                <p className="text-xs text-muted-foreground">Worksheets, PDFs, audio, video or images students can open from their console.</p>
                <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={create.isPending}>
                    Upload files
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} disabled={create.isPending}>
                    Add from library
                  </Button>
                </div>
                <LibraryFilePicker
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  excludeIds={new Set(libraryFiles.map((a) => a.id))}
                  onPick={(picked) => setLibraryFiles((prev) => [...prev, ...picked])}
                />
                {(files.length > 0 || libraryFiles.length > 0) && (
                  <ul className="space-y-1 rounded-md border border-border p-2">
                    {libraryFiles.map((asset) => (
                      <li key={asset.id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate">{asset.title ?? asset.filename}</span>
                        <Badge variant="outline">library</Badge>
                        <span className="text-xs text-muted-foreground">{formatSize(asset.sizeBytes)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={create.isPending}
                          onClick={() => setLibraryFiles((prev) => prev.filter((a) => a.id !== asset.id))}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                    {files.map((file, i) => (
                      <li key={`${file.name}-${i}`} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={create.isPending}
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                onClick={() => {
                  setError(null);
                  create.mutate();
                }}
                disabled={create.isPending || !title || (selected.size === 0 && files.length === 0 && libraryFiles.length === 0)}
              >
                {create.isPending ? (files.length > 0 ? 'Uploading…' : 'Creating…') : 'Create'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-3">
          {modules?.map((mod) => (
            <ModuleCard key={mod.id} mod={mod} onDelete={() => remove.mutate(mod.id)} />
          ))}
          {modules?.length === 0 && <p className="text-sm text-muted-foreground">No study modules yet.</p>}
        </div>
      )}
    </div>
  );
}

function ModuleCard({ mod, onDelete }: { mod: StudyModule; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState<StudyMaterial | null>(null);

  const saveDescription = useMutation({
    mutationFn: () => studyModulesApi.update(mod.id, { description: draft.trim() }),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.studyModules });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save the description'),
  });

  const patchMaterials = useMutation({
    mutationFn: async (change: { add?: File[]; addIds?: string[]; removeId?: string }) => {
      const uploaded = await Promise.all((change.add ?? []).map(uploadMaterial));
      const kept = mod.materials.map((m) => m.id).filter((id) => id !== change.removeId);
      return studyModulesApi.update(mod.id, { materialAssetIds: [...kept, ...(change.addIds ?? []), ...uploaded] });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.studyModules });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to update study module'),
  });

  function onPick(picked: FileList | null): void {
    if (picked && picked.length > 0) patchMaterials.mutate({ add: Array.from(picked) });
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between">
          <p className="font-medium">{mod.title}</p>
          <div className="flex items-center gap-1">
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
            <Button
              variant="ghost"
              size="sm"
              disabled={editing}
              onClick={() => {
                setDraft(mod.description ?? '');
                setEditing(true);
              }}
            >
              {mod.description ? 'Edit description' : 'Add description'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)} disabled={patchMaterials.isPending}>
              Add from library
            </Button>
            <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()} disabled={patchMaterials.isPending}>
              {patchMaterials.isPending ? 'Uploading…' : 'Add files'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </div>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={DESCRIPTION_MAX}
              rows={4}
              autoFocus
              placeholder="Guide your students: what to read or listen to first, what to practise, how long to spend, what to aim for…"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => saveDescription.mutate()} disabled={saveDescription.isPending}>
                {saveDescription.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saveDescription.isPending}>
                Cancel
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {draft.length}/{DESCRIPTION_MAX}
              </span>
            </div>
          </div>
        ) : (
          mod.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{mod.description}</p>
        )}
        {(mod.exercises.length > 0 || mod.materials.length === 0) && (
          <div className="flex flex-wrap gap-1.5">
            {mod.exercises.map((ex) => (
              <Badge key={ex.id} variant="outline">
                {ex.title}
              </Badge>
            ))}
            {mod.exercises.length === 0 && <p className="text-xs text-muted-foreground">Nothing in this module.</p>}
          </div>
        )}
        {mod.materials.length > 0 && (
          <ul className="space-y-1">
            {mod.materials.map((material) => (
              <li key={material.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm">
                <Badge variant="secondary">{material.kind}</Badge>
                <span className="flex-1 truncate">{material.title}</span>
                <span className="text-xs text-muted-foreground">{formatSize(material.sizeBytes)}</span>
                <Button size="sm" variant="outline" onClick={() => setPreviewMaterial(material)}>
                  Open
                </Button>
                <Button size="sm" variant="ghost" disabled={patchMaterials.isPending} onClick={() => patchMaterials.mutate({ removeId: material.id })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <LibraryFilePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          excludeIds={new Set(mod.materials.map((m) => m.id))}
          busy={patchMaterials.isPending}
          onPick={(picked) => patchMaterials.mutate({ addIds: picked.map((a) => a.id) })}
        />
        <AssetPreviewDialog asset={previewMaterial} onClose={() => setPreviewMaterial(null)} />
      </CardContent>
    </Card>
  );
}

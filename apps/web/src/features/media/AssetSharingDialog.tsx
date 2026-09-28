import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { mediaAssetsApi, type MediaAsset } from '../../lib/media-assets-api';
import { queryKeys } from '../../lib/query-keys';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { audienceOf, ClassAudiencePicker, isAudienceComplete, toSharedBatchIds } from './ClassAudiencePicker';

/** Changes who a library file is shown to in students' Study Material: nobody, everyone, or chosen classes. */
export function AssetSharingDialog({ asset, onClose }: { asset: MediaAsset | null; onClose: () => void }) {
  return (
    <Dialog open={asset !== null} onOpenChange={(open) => !open && onClose()}>
      {asset && (
        <DialogContent className="max-w-md">
          <SharingBody key={asset.id} asset={asset} onClose={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function SharingBody({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(asset.studentVisible);
  const [audience, setAudience] = useState(() => audienceOf(asset.sharedBatchIds));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    // The classes are sent even while the file is switched off, so turning it
    // back on later returns to the same audience instead of silently widening.
    mutationFn: () => mediaAssetsApi.update(asset.id, { studentVisible: visible, sharedBatchIds: toSharedBatchIds(audience) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mediaAssets });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save'),
  });

  const canSave = !visible || isAudienceComplete(audience);

  return (
    <>
      <DialogHeader className="pr-6">
        <DialogTitle className="truncate">Share “{asset.title ?? asset.filename}”</DialogTitle>
        <DialogDescription>Choose which students see this file in their Study Material.</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={visible} onCheckedChange={(c) => setVisible(c === true)} />
          Show in students’ Study Material
        </label>
        {visible && <ClassAudiencePicker value={audience} onChange={setAudience} />}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  );
}

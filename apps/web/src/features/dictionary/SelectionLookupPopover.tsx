import { useDictionaryStore } from '../../stores/dictionary-store';
import { useSelectionLookup } from './use-selection-lookup';

/**
 * The small floating "Look up" button that appears over a text selection
 * inside a `[data-dictionary-scope]` element (spec §6.1). Mounted once,
 * high in the tree (StudentConsole) — it has no idea which activity or
 * passage the selection came from, only that it's somewhere eligible.
 */
export function SelectionLookupPopover({ dictionaryEnabled }: { dictionaryEnabled: boolean }) {
  const info = useSelectionLookup(dictionaryEnabled);
  if (!info) return null;

  return (
    <button
      type="button"
      style={{ position: 'fixed', top: info.rect.bottom + 6, left: info.rect.left, zIndex: 60 }}
      // Selection is lost the instant a mousedown lands elsewhere in the
      // page — preventing default here keeps it intact until the click
      // actually fires, so `info.word` is still valid when it does.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        useDictionaryStore.getState().openWith(info.word);
        window.getSelection()?.removeAllRanges();
      }}
      className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-lg hover:opacity-90"
    >
      Look up “{info.word}”
    </button>
  );
}

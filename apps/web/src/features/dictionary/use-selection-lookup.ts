import { useEffect, useState } from 'react';
import { extractLookupWord } from '@lab/shared';

export interface SelectionLookupInfo {
  word: string;
  rect: DOMRect;
}

/**
 * Select-and-look-up (spec §6.1, "the one that actually gets used"):
 * watches the document's text selection and surfaces a "Look up"
 * affordance only when the selection sits inside a
 * `[data-dictionary-scope]` element (reading passages, test prompts —
 * never arbitrary chrome) and resolves to a single lookup-able word
 * (extractLookupWord, shared with the server's own normalization).
 *
 * A plain `selectionchange` listener, not a React state lifted from the
 * scoped elements themselves — those elements are plain server-rendered
 * text with no selection-handling code of their own, so this hook is the
 * one place that needs to know about the feature at all.
 */
export function useSelectionLookup(enabled: boolean): SelectionLookupInfo | null {
  const [info, setInfo] = useState<SelectionLookupInfo | null>(null);

  useEffect(() => {
    if (!enabled) {
      setInfo(null);
      return;
    }

    function handleSelectionChange(): void {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setInfo(null);
        return;
      }
      const anchor = selection.anchorNode;
      const anchorEl = anchor instanceof Element ? anchor : anchor?.parentElement;
      if (!anchorEl?.closest('[data-dictionary-scope]')) {
        setInfo(null);
        return;
      }
      const word = extractLookupWord(selection.toString());
      if (!word) {
        setInfo(null);
        return;
      }
      setInfo({ word, rect: selection.getRangeAt(0).getBoundingClientRect() });
    }

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [enabled]);

  return info;
}

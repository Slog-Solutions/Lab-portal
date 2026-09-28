import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StationControlClient } from '../../lib/station-control-client';
import { stationApi } from '../../lib/station-api';
import { queryKeys } from '../../lib/query-keys';

/** How often a visible Study Material pane re-reads the teacher's library. */
const POLL_MS = 15_000;

/**
 * The student's view of the teacher's Study Library. The student console keeps
 * every pane mounted once someone has signed in, so a plain fetch-on-mount
 * would freeze the list at sign-in time: a module the teacher adds, edits or
 * deletes afterwards would never appear (or disappear) on this seat. This
 * keeps it in step instead — it re-reads when the pane is opened, when the
 * window regains focus (react-query's default), and every POLL_MS while the
 * pane is showing. `paused` stops the polling while a student is working
 * through an exercise, so a refresh can't churn state under them.
 *
 * What a student sees is two lists: the teacher's modules, and the loose files
 * the teacher switched on in the Files tab (`files`, never one that is already
 * inside a module). Shared by the Study Material pane and the home summary card
 * through one query key, so they never disagree about what the library holds.
 */
export function useStudyLibrary(control: StationControlClient, { active, paused = false }: { active: boolean; paused?: boolean }) {
  const query = useQuery({
    queryKey: queryKeys.studentStudyLibrary,
    queryFn: async () => {
      const token = control.getToken();
      const [modules, files] = await Promise.all([
        stationApi.studyLibrary(token),
        // Additive list: if it fails, the modules still show and the next poll retries.
        stationApi.studyLibraryFiles(token).catch(() => []),
      ]);
      return { modules, files };
    },
    refetchInterval: active && !paused ? POLL_MS : false,
  });

  const { refetch } = query;
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void refetch();
    wasActive.current = active;
  }, [active, refetch]);

  return query;
}

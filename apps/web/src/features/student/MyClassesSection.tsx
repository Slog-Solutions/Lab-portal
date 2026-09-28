import { useEffect, useState } from 'react';
import type { StationControlClient } from '../../lib/station-control-client';
import type { StudentSessionUser } from '../../stores/student-session-store';
import { MyClassesPanel } from './MyClassesPanel';
import { StudentClassDetail } from './StudentClassDetail';

/**
 * The drawer's "My Classes": every class the student has joined (and the
 * form to join another), and — once one is opened — what they did in it.
 * Opening a class is local state, not a route: the student console has no
 * routes of its own (see StudentConsole's section state). A different
 * student signing in at this seat starts back on the list.
 */
export function MyClassesSection({
  control,
  student,
  active,
  onOpenAssignments,
}: {
  control: StationControlClient;
  student: StudentSessionUser;
  active: boolean;
  onOpenAssignments: () => void;
}) {
  const [openClassId, setOpenClassId] = useState<string | null>(null);

  useEffect(() => setOpenClassId(null), [student.id]);

  return (
    <div className="flex w-full flex-col items-center">
      {openClassId ? (
        <StudentClassDetail
          key={openClassId}
          classId={openClassId}
          control={control}
          active={active}
          onBack={() => setOpenClassId(null)}
          onOpenAssignments={onOpenAssignments}
        />
      ) : (
        <MyClassesPanel onOpen={setOpenClassId} />
      )}
    </div>
  );
}

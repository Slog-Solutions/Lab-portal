import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface StudentSessionUser {
  id: string;
  serviceNumber: string;
  fullName: string;
}

interface StudentSessionState {
  token: string | null;
  student: StudentSessionUser | null;
  setSession: (token: string, student: StudentSessionUser) => void;
  clear: () => void;
}

/**
 * A student's own signed-in identity at a seat (POST /classroom/sign-in —
 * see StationsService.claim's doc comment on why that route mints a real
 * STUDENT JWT). Deliberately a separate store from useAuthStore
 * (apps/web/src/stores/auth-store.ts), which holds a dashboard ADMIN/
 * TEACHER/STUDENT session for the browser dev-testing login path: a real
 * seat needs both a station identity (this seat) and, layered on top of
 * it, whichever student is currently signed in.
 *
 * Persisted to sessionStorage, not localStorage like lab-auth — a lab
 * seat is shared hardware. sessionStorage survives a renderer reload
 * (so a student mid-assignment doesn't lose their session on an
 * accidental refresh) but is cleared when the Electron window/tab
 * actually closes, so the next student at the seat starts signed out.
 */
export const useStudentSession = create<StudentSessionState>()(
  persist(
    (set) => ({
      token: null,
      student: null,
      setSession: (token, student) => set({ token, student }),
      clear: () => set({ token: null, student: null }),
    }),
    {
      name: 'lab-student-session',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

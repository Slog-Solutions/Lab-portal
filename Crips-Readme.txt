I reset the local dev database (labportal on localhost:5432) completely — dropped and recreated every table via prisma migrate reset, regenerated the Prisma client (had to kill a stray dev server on port 3000 that was locking the query-engine DLL first), then ran the seed. I also edited seed.ts to seed 3 teachers instead of 1 (it previously only created one).

Verified final state — exactly this and nothing else:

Role	Count	IDs	Password
Admin	1	ADMIN-001	Admin@12345
Teacher	3	TCH-001 (R.S. Shekhawat, Lt Col), TCH-002 (A.K. Mehta, Maj), TCH-003 (P. Iyer, Capt)	Teacher@12345
Student	40	STU-001…STU-040, all enrolled in one batch "ACTC Batch 01"	Student@12345
Sessions, stations, ad hoc exercises, attempts, media — all 0. The only content present is the built-in CEFR A1/A2/B1 seed pack (12 exercises across Listening/Speaking/Reading/Grammar) owned by TCH-001, so Exercises/Study Library aren't empty on first login.

To boot it up: npm run dev:all from the repo root (LiveKit, server on :3000, web on :5173 — LiveKit is required for screen/audio broadcast, remote-control and group activities; npm run dev:web alone skips it), then open http://localhost:5173.

Flow — Admin (ADMIN-001)
Log in at /login → lands on Dashboard (Status Board).
As real/simulated stations connect, they register themselves automatically (by machine identity) but stay unclaimed — invisible on the seat grid until you assign them a seat number in the "unclaimed stations" panel.
Once seated, admin-only controls appear on the grid: lock/unlock a seat, remote-control a seat, shut down a station, etc. (Teachers see the same grid read-only.)
Admin also has full access to Sessions/Media/Exercises/Study Library/Gradebook/Reports (same nav as teachers).
Flow — Teacher (TCH-001/002/003)
Log in → Dashboard (status board, view-only — no seat-claim/lock controls).
Sessions: create a session, pick the batch ("ACTC Batch 01"), split it into up to 6 groups, assign seated stations to each group, and pick an activity per group (Round Table, Telephone, Model Imitation, Vocabulary Test, Conference Interpreting). Start the session → each group runs its own activity live and simultaneously.
Media Library: upload/share audio-video assets (private/department/institution scope).
Exercises: author item-bank exercises (vocabulary tests, pronunciation drills).
Study Library: bundle exercises into self-study modules students can reach on their own.
Gradebook: review/override scores from attempts.
Reports: export PDFs/summaries.
Flow — Student (physical seat, no password)
A seat (Electron app, or a browser at /student for testing) boots straight into the student console — no login screen at all, it auto-registers its own station identity.
It sits idle/locked until an admin assigns it a seat number and a teacher puts it into a session group — then it shows whatever that group's activity is (video/audio broadcast, the activity player, teacher remote-control, etc.).
To see My Assignments or browse the Study Library outside a live teacher session, the student just types their bare Service Number (e.g. STU-014) into the console — no password, it's a roster pick, not authentication — which is what attaches their attempts/scores to the right student record.
(For quick browser-only testing without a physical seat, STU-001…STU-040/Student@12345 also works through the normal /login page and drops straight into /student — that's a dev convenience, not how a real seat works.)
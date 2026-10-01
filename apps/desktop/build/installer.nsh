; Custom NSIS install steps (design doc §3.6 "elevation happens exactly
; once, at install"). services/lab-agent-svc (Phase 5) now REALLY
; implements every step below — GPO policy writes, root CA import,
; firewall rule, service registration, all reviewable and individually
; testable (see that package's README for what's actually been run vs.
; only reviewed). What's still missing is THIS file calling it: doing so
; from NSIS means either bundling a portable Node runtime into the
; installer or compiling lab-agent-svc to a standalone .exe (e.g. via
; `pkg`) and shipping it as an extraResource — tracked as the concrete
; next step, not silently skipped:
;   - Register + start the LabAgentSvc Windows service
;   - Import the internal root CA into the machine's Trusted Root store
;     (certutil -addstore -f Root LabCA.crt)
;   - Write the input-lock GPO policy keys (DisableTaskMgr, etc. — design
;     doc §3.2)
;   - Add firewall rules scoped to the lab subnet
;
; Intentionally still empty so `electron-builder.yml`'s nsis.include
; reference resolves and a dev build succeeds without bundling Node.

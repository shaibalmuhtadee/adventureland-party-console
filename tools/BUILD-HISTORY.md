# Build history and rollback

From the repository root:

```powershell
npm run builds -- list
npm run builds -- rollback game <full-build-id>
npm run builds -- rollback dashboard <full-build-id>
npm run builds -- resume game
npm run builds -- resume dashboard
npm run builds -- clean
npm run builds -- clean --apply
```

For cleanup flags, use `clean all --apply` (or `game` / `dashboard`) when passing
an explicit stream. `clean` previews paths and byte counts without deleting.
The dashboard commands require the local supervisor at port 3010; override with
`AL_DASHBOARD_PUBLIC_PORT` for another supervisor port.

## What a version means

- **Game:** a verified set of seven class bundles, with a full manifest and first
  recorded timestamp. Published history lives in `characters/build-history.json`;
  staged history lives in `.build/game/build-history.json`.
- **Dashboard:** a complete release which passed the supervisor health check.
  Its ID and first recorded timestamp live in `dashboard/.build/history.json`.
- These are separate histories, not full application/database snapshots.
  Coordinator code, character data, configuration, and saved game state are not
  rolled back. Old code must still be compatible with the running coordinator.

The latest 20 distinct recorded builds are retained in each store. Rebuilding
identical code does not create another version. Active older versions are also
protected. The dashboard protects both its active and previous serving releases,
as well as candidate releases registered by other live local supervisors.

Game rollback verifies all bundle checksums before atomically selecting its
manifest. The normal loaders adopt it at their next safe reload opportunity;
the command confirms publication, not that every character has loaded it.
Rollback pins publication, so the build watcher may stage newer code but cannot
silently replace the selected version. `resume game` publishes the latest staged
build and releases that pin. Build first if source changes have not been staged.

Dashboard rollback starts the chosen release and health-checks it before switching
traffic. The previous server remains available for old browser assets and as a
fallback if the new process exits. The selection survives supervisor restarts.
`resume dashboard` builds/selects current source and removes the rollback pin.
Changing dashboard mode explicitly also releases that pin.

## Cleanup and migration

Successful game builds and dashboard activations prune obsolete generated outputs.
Existing verified current manifests are imported as baseline game versions.
Untracked historical hashes are not reconstructed into fictional versions.
The first dashboard activation records its current release; untracked old release
directories are eligible for removal. Dashboard `validation` is disposable build
output. Mode settings and other unknown files are preserved.

Cleanup checks absolute paths and refuses symbolic links/junctions. Build,
publication, rollback, and cleanup use store locks. No time-based grace period is
used. A loader racing many rapid publications can retry the newest manifest;
already executing character code remains in memory.

An interrupted process can leave `operation.lock` behind. The store reclaims
it automatically when `owner.json` names a PID that is no longer running
(`ESRCH`); live owners are never disturbed and locks are never stolen based
only on age. If the lock persists, inspect its `owner.json`, confirm that
PID is no longer running and no build is active, then remove that specific
lock directory.

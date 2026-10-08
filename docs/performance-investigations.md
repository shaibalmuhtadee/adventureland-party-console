# Rising game ping

Game ping includes local socket-callback delay. The client averages 40 samples
at roughly 3.2-second intervals, so CPU stalls can appear as a slow network
regression. `reduce_cooldown` only advances the client's skill deadline.
The crab runtime already compensates after acknowledgement.

On 2026-10-08, rogue crab farming repeatedly called `isPassingEncounter` through
target, skill and movement checks. Each call scanned recent deaths and serialized
their identities before checking whether a passing reservation existed. Fast
kills filled the history and increased synchronous work. Fix `5c8497f` checks
reservations first and retains death rejection for reserved encounters.

Live evidence: `passingKey` fell from 60.15% to 0.22% of CPU samples. After a full
restart and four minutes of farming, ping settled at 15–17 ms with 512 coordinator
death records and 367 local deaths. Typecheck passed; no E2E tests ran.

For similar reports:

- Profile the active worker and coordinator before changing compensation.
- Check hot loops for repeated history scans, serialization and growing state.
- Put cheap ownership checks before expensive history work. Index repeated
  membership lookups when scans remain necessary.
- Confirm the loaded generation. The watcher can reload a fix during profiling.
- Verify with populated histories and fresh ping samples; a restart alone proves
  little. The initial login sample can inflate the average for about two minutes.
- Use the supported full restart for character changes. Stop probes and close
  inspectors afterward, while leaving the game running.

Local profiles and timestamped readings remain in
`.build/investigation-20261008/REPORT.md`; these ignored artifacts are not portable.

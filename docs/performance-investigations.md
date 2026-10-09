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

## Metrics history and departure checks, 2026-10-09

Extending the gold graph exposed another expensive read path. Its one-second
refresh re-aggregated all metric fields over the entire retained range, including
damage and loot it did not display. A 2.28-day request returned about 983 KB.
Gold now reads balance endpoints only, yields after 64 historical buckets, and
refreshes on the ten-second history cadence. The same range returns about 256 KB.

The live rogue profile also found `departureTargetEngaged` scanning retained
coordinator deaths for every visible neutral monster. Check defense/attacker
ownership first, then retain the same death rejection for engaged targets.
That callback fell from 10.64% of CPU samples to zero in the observed profile.
The coordinator's earlier tombstone `Set` index was absent from the current
source and was restored for death and claim membership checks.

After a full restart and four minutes of continued farming and repeated reads
against retained gold history, the final-minute ping ranges were 12.43–12.88 ms
for the rogue and 11.35–11.60 ms for the merchant. Coordinator event-loop
utilization during the request sequence fell from 44.66% to 29.37%; p99 delay
fell from 54.49 to 36.34 ms. These are observed windows, not guarantees for every
future workload. The initial login sample again inflated the rolling average.

Typecheck, JavaScript syntax checks and the new reader's coordinator lint passed.
The legacy metrics service retains existing complexity lint violations. No unit
or E2E tests ran. Diagnostics and a repeatable read-only observer are preserved in
`.build/investigation-20261009/REPORT.md`; the corresponding CPU profiles are
`.build/investigation-20261008/metrics-*.cpuprofile`.

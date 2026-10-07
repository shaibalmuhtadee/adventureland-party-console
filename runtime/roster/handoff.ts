export type HandoffPhase =
  | "awaiting-realm-choice"
  | "preparing"
  | "release"
  | "confirm-release"
  | "headless-starting"
  | "navigate"
  | "complete"
  | "failed";
export interface Handoff {
  /** Game-window session that requested the operation; CODE reloads retain it. */
  steamSessionId?: string;
  destinationRealm?: string;
  realmChoice?: { current: string | null; home: string | null };
  bulkRemaining?: string[];
  multi?: { action: "primary" | "login" | "headless" | "logout"; subject: string;
    before: string[]; desired: string[]; primary: string | null; release: string[];
    arrived?: string[]; headlessStarted?: boolean; stoppedHeadless?: boolean; releaseIssued?: boolean };
  id: string;
  from: string | null;
  target: string | null;
  returnToHeadless: boolean;
  returnSlot: number | null;
  targetSlot: number | null;
  startedAt: number;
  phaseAt?: number;
  releasedAt?: number;
  phase: HandoffPhase;
  error: string | null;
}
export interface RosterOwnership {
  steam?: string[];
  native: string | null;
  slots: (string | null)[];
  handoff: Handoff | null;
}
export interface HandoffPorts {
  steamSessionId?(): string | undefined;
  realmContext?(): { current: string | null; home: string | null } | undefined;
  observedRealm?(name: string, since?: number): string | null;
  prepareSteam?(name: string): Promise<void>;
  now(): number;
  id(): string;
  save(): void;
  bridgeReady(): boolean;
  owned(name: string): boolean;
  /** Includes game limits and active inventory operations. */
  validateParticipants(names: string[]): void;
  stopHeadless(name: string): Promise<void>;
  startHeadless(name: string, slot: number, realm?: string): void;
  headlessReady?(name: string): boolean;
  /** Must query authoritative account data, never infer offline from heartbeat age. */
  confirmOffline(name: string): Promise<boolean>;
}
export class RosterConflict extends Error {}

export function releaseConfirmed(state: RosterOwnership, operation: Handoff): boolean {
  return operation.releasedAt !== undefined || (!!operation.from && operation.returnSlot !== null &&
    state.slots[operation.returnSlot] === operation.from && state.native !== operation.from);
}

/** An already returned headless participant is safe to restore after restart. */
export function reservedForSteam(state: RosterOwnership, name: string): boolean {
  if (state.steam?.includes(name)) return true;
  const operation = state.handoff;
  if (operation?.multi && operation.phase !== "complete")
    return operation.multi.desired.includes(name) || (!operation.releasedAt && operation.multi.release.includes(name));
  if (!operation || operation.phase === "complete") return false;
  if (name === operation.target) return true;
  return name === operation.from && !releaseConfirmed(state, operation);
}

/** Session ownership is retained on failure, so recovery cannot double-login. */
export class SteamHandoff {
  private advancing = false;
  readonly state: RosterOwnership;
  private readonly ports: HandoffPorts;
  constructor(state: RosterOwnership, ports: HandoffPorts) {
    this.state = state;
    this.ports = ports;
  }

  private update(phase: HandoffPhase, error: string | null = null): Handoff {
    const operation = this.state.handoff;
    if (!operation) throw new RosterConflict("No handoff is pending");
    if (operation.phase !== phase) operation.phaseAt = this.ports.now();
    operation.phase = phase;
    operation.error = error;
    this.ports.save();
    return operation;
  }

  private validateTarget(target: string | null): string | null {
    const pending = this.state.handoff;
    if (pending && pending.phase !== "complete")
      throw new RosterConflict("Resolve the pending Steam handoff first");
    if (!this.ports.bridgeReady())
      throw new RosterConflict("Run the Steam bridge before changing session ownership");
    if (target && !this.ports.owned(target)) throw new RosterConflict("Unknown character");
    const from = this.state.native;
    if (from === target) throw new RosterConflict("That character is already active in Steam");
    if (!from && !target) throw new RosterConflict("No Steam character is active");
    return from;
  }
  private transferSlots(from: string | null, target: string | null, returnToHeadless: boolean) {
    const targetSlot = target ? this.state.slots.indexOf(target) : -1;
    const freeSlot = targetSlot >= 0 ? targetSlot : this.state.slots.indexOf(null);
    if (from && returnToHeadless && freeSlot < 0)
      throw new RosterConflict("No headless slot is available");
    return {
      returnSlot: from && returnToHeadless ? freeSlot : null,
      targetSlot: targetSlot >= 0 ? targetSlot : null,
    };
  }
  private reserve(target: string | null, returnToHeadless: boolean): Handoff {
    const from = this.validateTarget(target);
    const slots = this.transferSlots(from, target, returnToHeadless);
    const participants = this.state.slots.filter(
      (name): name is string => !!name && name !== target,
    );
    if (from && returnToHeadless) participants.push(from);
    if (target) participants.push(target);
    this.ports.validateParticipants(participants);
    return {
      id: this.ports.id(),
      steamSessionId: this.ports.steamSessionId?.(),
      from,
      target,
      returnToHeadless,
      ...slots,
      startedAt: this.ports.now(),
      phase: "preparing",
      error: null,
    };
  }

  private transferReleasedSlot(operation: Handoff): void {
    // One logical slot transfers from the old headless target to the former
    // native character only after both releases have been confirmed.
    if (operation.targetSlot !== null) this.state.slots[operation.targetSlot] = null;
    this.state.native = null;
    operation.releasedAt = this.ports.now();
    if (operation.returnSlot !== null && operation.from) {
      this.state.slots[operation.returnSlot] = operation.from;
      this.ports.save();
      this.ports.startHeadless(operation.from, operation.returnSlot);
    }
    this.update(operation.target ? "navigate" : "complete");
  }

  async begin(target: string | null, returnToHeadless = true): Promise<Handoff> {
    const operation = this.reserve(target, returnToHeadless);
    this.state.handoff = operation;
    this.ports.save();
    try {
      if (operation.target) {
        if (operation.targetSlot !== null) await this.ports.stopHeadless(operation.target);
        if (!(await this.ports.confirmOffline(operation.target)))
          throw new RosterConflict(
            "Target is still online; Steam has not been instructed to switch",
          );
      }
      if (operation.phase !== "preparing") return operation;
      return this.update("release");
    } catch (error) {
      return this.update("failed", String(error));
    }
  }

  private releaseOperation(id: string, character: string | null): Handoff {
    const operation = this.state.handoff;
    if (!operation || operation.id !== id || operation.from !== character)
      throw new RosterConflict("Stale Steam release acknowledgement");
    return operation;
  }
  /** Repeated bridge acknowledgements are harmless, including after reconnects. */
  async released(id: string, character: string | null): Promise<void> {
    const operation = this.releaseOperation(id, character);
    if (operation.phase !== "release" && operation.phase !== "confirm-release") return;
    if (this.advancing) return;
    this.advancing = true;
    this.update("confirm-release");
    try {
      if (operation.from && !(await this.ports.confirmOffline(operation.from))) return;
      if (operation.phase !== "confirm-release") return;
      this.transferReleasedSlot(operation);
    } catch (error) {
      this.update("failed", String(error));
    } finally {
      this.advancing = false;
    }
  }

  private arrivalReady(operation: Handoff): boolean {
    if (operation.phase === "navigate") return true;
    if (operation.phase !== "failed" || this.state.native) return false;
    if (operation.target && this.state.slots.includes(operation.target)) return false;
    // Older persisted handoffs predate releasedAt. The transferred slot proves
    // their release was confirmed before the previous native was started there.
    return releaseConfirmed(this.state, operation);
  }
  reconcileArrival(character: string | null): boolean {
    const operation = this.state.handoff;
    if (!character || !operation || operation.target !== character || !this.arrivalReady(operation)) return false;
    this.arrived(operation.id, character);
    return true;
  }
  private arrivalOperation(id: string, character: string): Handoff {
    const operation = this.state.handoff;
    if (!operation || operation.id !== id || operation.target !== character || !this.arrivalReady(operation))
      throw new RosterConflict("Stale Steam arrival acknowledgement");
    return operation;
  }
  arrived(id: string, character: string): void {
    const operation = this.state.handoff;
    if (operation?.id === id && operation.phase === "complete" && this.state.native === character)
      return;
    this.arrivalOperation(id, character);
    this.state.native = character;
    this.update("complete");
  }

  fail(id: string, error: string): void {
    if (this.state.handoff?.id !== id) throw new RosterConflict("Stale handoff failure");
    if (this.state.handoff.phase === "complete") return;
    this.update("failed", error);
  }

  /** Safe recovery only after both relevant characters are authoritatively offline. */
  async cancel(): Promise<void> {
    const operation = this.state.handoff;
    if (!operation || operation.phase === "complete") return;
    if (this.advancing || operation.phase !== "failed")
      throw new RosterConflict("Handoff is still in progress");
    for (const name of [operation.from, operation.target]) await this.releaseForRecovery(name);
    this.state.native = null;
    // A cancelled handoff leaves offline characters available for explicit
    // assignment. It never silently starts a session after a timeout.
    this.state.slots = this.state.slots.map((name) =>
      name === operation.from || name === operation.target ? null : name,
    );
    this.state.handoff = null;
    this.ports.save();
  }
  private async releaseForRecovery(name: string | null): Promise<void> {
    if (!name) return;
    // Navigation may have failed after the previous native returned headless.
    if (this.state.slots.includes(name) && this.state.native !== name)
      await this.ports.stopHeadless(name);
    if (!await this.ports.confirmOffline(name))
      throw new RosterConflict(`${name} is still online; ownership remains reserved`);
  }

  expire(timeoutMs = 90000): void {
    const operation = this.state.handoff;
    if (
      operation &&
      !["complete", "failed", "preparing"].includes(operation.phase) &&
      this.ports.now() - (operation.phaseAt ?? operation.startedAt) >= timeoutMs
    )
      this.update("failed", "Steam handoff timed out; ownership remains reserved until recovery");
  }
}

import { merchantMovementBlocked, type MerchantMovementState } from "./movement-block.ts";
import {
  collectionSlotCount,
  isItemCollection,
  merchantCollectionNearby,
  markedCollectionReady,
  freshCollectionStatus,
} from "./collection.ts";
import { coordinatorMerchantPriority, coordinatorMerchantTransferBlocked } from "./job-policy.ts";
import { selectMerchantJob, stampMerchantJob } from "./priority.ts";
import type { PrioritizedJob } from "./priority.ts";
import type { InventoryEntry, ItemMark } from "../contracts/item.ts";
import type { ObservedPosition } from "../contracts/position.ts";
import { collectionPickups, type PickupState } from './collection-pickups.ts';
import { pickupReason } from './pickup-jobs.ts';

interface CollectionState extends PickupState, MerchantMovementState {
  merchantCharacter: string | null;
  statuses: Record<string, (ObservedPosition & { items?: (InventoryEntry | null)[] }) | undefined>;
  marked?: Record<string, ItemMark[] | undefined>;
  merchantMarked?: Record<string, ItemMark[] | undefined>;
  itemCollectionThreshold: number;
  upgrades?: Record<string, { slot?: number | string; item?: import('../contracts/item.ts').Item; auto?: boolean; equipped?: boolean }[] | undefined>;
  autoCompounds?: Record<string, {name:string;targetTier?:number;quantity?:number}[] | undefined>;
}
type PriorityState = Parameters<typeof coordinatorMerchantPriority>[0];
interface QueueState<Job extends PrioritizedJob> extends CollectionState, PriorityState {
  merchantQueue: Job[];
}

export function coordinatorCollectionSlots(
  state: CollectionState,
  name: string | null | undefined,
  reason = 'marked items',
): number {
  const {bank, keep} = collectionPickups(state, String(name), reason);
  return collectionSlotCount(state.statuses[String(name)]?.items || [], bank.concat(keep));
}

export function coordinatorCollectionNearby(
  state: CollectionState,
  name: string | null | undefined,
  now: () => number,
): boolean {
  return merchantCollectionNearby(
    state.statuses[String(state.merchantCharacter)],
    state.statuses[String(name)],
    now(),
  );
}

/** Automatic party collections require inventory pressure even when the merchant is nearby. */
export function coordinatorCollectionReady(
  state: CollectionState,
  job: PrioritizedJob,
  now: () => number,
): boolean {
  if (merchantMovementBlocked(state, job)) return false;
  const reason = pickupReason(job.reason, job.target, state.merchantCharacter);
  if (job.manual !== true && ['marked items', 'inventory cleanout', 'party collection'].includes(reason)) {
    const target = state.statuses[String(job.target)];
    if (!freshCollectionStatus(target, now()) || !Array.isArray(target?.items)) return false;
    if (target.items.filter(entry => !entry).length > 7) return false;
  }
  if (!isItemCollection(reason)) return true;
  return markedCollectionReady(
    reason,
    state.statuses[job.target!],
    coordinatorCollectionSlots(state, job.target, reason),
    state.itemCollectionThreshold,
    coordinatorCollectionNearby(state, job.target!, now),
    now(),
  );
}

/** Item marks retain collection intent; an ineligible pickup is not a queued job. */
export function pruneIneligibleCollections<Job extends PrioritizedJob>(
  state: QueueState<Job> & {transferSignatures?: Record<string,string>}, now: () => number,
): boolean {
  const retained = state.merchantQueue.filter(job => {
    if (merchantMovementBlocked(state,job) || coordinatorCollectionReady(state,job,now)) return true;
    if (state.transferSignatures && job.target) delete state.transferSignatures[job.target];
    return false;
  });
  if (retained.length === state.merchantQueue.length) return false;
  state.merchantQueue = retained;
  return true;
}

/** Remove and stamp only the selected eligible job; retain other blocked work. */
export function takeCoordinatorMerchantJob<Job extends PrioritizedJob>(
  state: QueueState<Job>,
  now: () => number,
) {
  const priority = (job: PrioritizedJob) => coordinatorMerchantPriority(state, job);
  const index = selectMerchantJob(state.merchantQueue, {
    now: now(),
    priority,
    capacityBlocked: (job) => coordinatorMerchantTransferBlocked(state, job),
    collectionReady: (job) => coordinatorCollectionReady(state, job, now),
  });
  return index === null
    ? null
    : stampMerchantJob(state.merchantQueue.splice(index, 1)[0]!, priority, now());
}

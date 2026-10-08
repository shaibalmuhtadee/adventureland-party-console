import type { NativeStandLedger } from "../commerce/native-stand.ts";
import type { createTransferCommands } from "../inventory/transfer-commands.ts";
import type { createRestockRoute } from "../http/restock.ts";
import type { StandBid } from "../commerce/bids.ts";
import type { PriceHistory, MerchantBlock } from "../commerce/market-types.ts";

/** Saved maps owned by commerce and inventory command handlers. */
export interface SavedServiceSettings {
  autoConsumables?: import('../../consumables.ts').AutoConsumables;
  nativeStand?: NativeStandLedger;
  autoStandBuys?: boolean;
  autoBlacklistMerchants?: boolean;
  merchantDeliveries?: Parameters<typeof createTransferCommands>[0]["merchantDeliveries"] | null;
  standBids?: Record<string, StandBid> | null;
  standPriceHistory?: Record<string, PriceHistory> | null;
  merchantBlacklist?: Record<string, MerchantBlock> | null;
  restockPolicies?: Parameters<typeof createRestockRoute>[0]["restockPolicies"] | null;
}

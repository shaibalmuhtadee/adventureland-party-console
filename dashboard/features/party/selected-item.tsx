"use client";
import { InventoryEntry } from "./inventory-entry";

export type SelectedItem = {
  catalog?: boolean;
  character: string;
  entry: InventoryEntry;
  exchangeAdd?: { enabled: boolean; onAdd: () => void };
  source?: { kind: "merchant" } | { kind: "bank"; pack: string };
};

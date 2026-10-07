"use client";

export type RosterMember = {
  name: string;
  ctype: string;
  level: number;
  id: string | number;
  online?: boolean;
  home?: string | null;
  homeWorld?: string;
  server?: string | null;
};

import type { InvestAssetKind, IsoDate, Paise } from "../../src/engine/index.ts";
import type { ParseWarning } from "./types.ts";

export type ParsedInvestAsset = {
  name: string;
  kind: InvestAssetKind;
  targetBp: number;
  dipPriority: number | null;
  instrumentNote: string;
  active: boolean;
  sheetRow: number;
};

export type ParsedInvestTier = {
  id: string;
  belowAmount: Paise | null;
  allowedNames: string[];
};

export type ParsedInvestGoal = {
  name: string;
  targetAmount: Paise | null;
  notes: string;
  sheetRow: number;
};

export type ParsedInvestWorkbook = {
  sipBp: number;
  dipReserveBp: number;
  savingsTarget: Paise;
  effectiveFrom: IsoDate;
  assets: ParsedInvestAsset[];
  themeTiers: ParsedInvestTier[];
  goals: ParsedInvestGoal[];
  warnings: ParseWarning[];
};

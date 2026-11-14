/** Hides a number when fewer than `k` students stand behind it (k-anonymity). Pure; applied in core, never in the UI. */
export const suppress = (value: number | null, n: number | undefined, k: number): number | null =>
  value === null || n === undefined || n < k ? null : value;

/** Mean mood 1..5 (5 = very good) → heatmap bucket 1 (positive) .. 5 (crisis); 0 is reserved for "no data". */
export const heatBucket = (mean: number): number => Math.min(5, Math.max(1, 6 - Math.round(mean)));

export const COHORT_PATTERN = /^(all|year:[1-6]|dept:[A-Z0-9]{1,10})$/;

export const signed = (value: number, digits = 0): string => `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(digits)}`;

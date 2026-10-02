/** Provider nulls, blanks and booleans are not reported zero balances. */
export function numeric(record: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw !== "number" && (typeof raw !== "string" || raw.trim() === "")) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

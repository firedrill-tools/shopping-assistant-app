/** Exact USD formatting for safe integer minor units, including negative remaining budget. */
export function money(cents: number) {
  if (!Number.isSafeInteger(cents))
    throw new Error("Money requires safe integer minor units");
  const amount = BigInt(cents),
    absolute = amount < 0n ? -amount : amount;
  const dollars = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(absolute / 100n);
  return `${amount < 0n ? "-" : ""}$${dollars}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function path(value: unknown, keys: readonly string[]): unknown {
  let current = value;
  for (const key of keys) {
    const currentRecord = record(current);
    if (!currentRecord || !(key in currentRecord)) return undefined;
    current = currentRecord[key];
  }
  return current;
}

export function toNonnegativeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0)
    return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function parseDisplayNumber(value: string): number | null {
  const match = value.match(/-?[\d\s.,]+/);
  if (!match) return null;
  let normalized = match[0].replace(/\s/g, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  const separator = Math.max(comma, dot);
  if (separator >= 0) {
    const decimalLength = normalized.length - separator - 1;
    const hasBoth = comma >= 0 && dot >= 0;
    const separatorCount = (normalized.match(/[.,]/g) ?? []).length;
    if (
      decimalLength >= 1 &&
      decimalLength <= 2 &&
      (hasBoth || separatorCount === 1)
    ) {
      const integerPart = normalized.slice(0, separator).replace(/[.,]/g, "");
      normalized = `${integerPart}.${normalized.slice(separator + 1)}`;
    } else {
      normalized = normalized.replace(/[.,]/g, "");
    }
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

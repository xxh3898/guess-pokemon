import { ApiError } from "./HttpClient";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireRecord(
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw ApiError.invalidResponse();
  }
  return value as Record<string, unknown>;
}

export function requireString(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw ApiError.invalidResponse();
  }
  return candidate;
}

export function requireBoolean(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  if (typeof candidate !== "boolean") {
    throw ApiError.invalidResponse();
  }
  return candidate;
}

export function requireInteger(
  value: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const candidate = value[key];
  if (
    typeof candidate !== "number" ||
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw ApiError.invalidResponse();
  }
  return candidate;
}

export function requireUuid(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = requireString(value, key);
  if (!UUID_PATTERN.test(candidate)) {
    throw ApiError.invalidResponse();
  }
  return candidate;
}

export function requireDateTime(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = requireString(value, key);
  if (Number.isNaN(Date.parse(candidate))) {
    throw ApiError.invalidResponse();
  }
  return candidate;
}

export function requireNullableDateTime(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  if (candidate === null) {
    return null;
  }
  return requireDateTime(value, key);
}

export function requireNullableUuid(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  if (candidate === null) {
    return null;
  }
  return requireUuid(value, key);
}

export function hasOwn(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

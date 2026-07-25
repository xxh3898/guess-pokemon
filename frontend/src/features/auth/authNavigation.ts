export function currentLocationPath(location: {
  hash: string;
  pathname: string;
  search: string;
}): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

export function safeReturnPath(state: unknown): string | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  const from = (state as Record<string, unknown>).from;
  if (
    typeof from !== "string" ||
    !from.startsWith("/") ||
    from.startsWith("//")
  ) {
    return null;
  }
  return from;
}

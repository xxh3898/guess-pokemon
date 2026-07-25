export const MAX_ANSWER_COMMENT_LENGTH = 200;

export function normalizeAnswerComment(
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().normalize("NFC");
  return normalized.length === 0 ? null : normalized;
}

export function countAnswerCommentCharacters(
  value: string | null,
): number {
  const normalized = normalizeAnswerComment(value);
  return normalized === null ? 0 : Array.from(normalized).length;
}

export function isAnswerCommentValue(
  value: unknown,
): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = normalizeAnswerComment(value);
  return (
    normalized === value &&
    countAnswerCommentCharacters(normalized) <=
      MAX_ANSWER_COMMENT_LENGTH
  );
}

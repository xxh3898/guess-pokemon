import { describe, expect, it } from "vitest";

import {
  countAnswerCommentCharacters,
  isAnswerCommentValue,
  normalizeAnswerComment,
} from "./answerComment";

describe("answerComment", () => {
  it("should_returnNull_when_commentIsMissingOrBlank", () => {
    expect(normalizeAnswerComment(null)).toBeNull();
    expect(normalizeAnswerComment(" \n ")).toBeNull();
  });

  it("should_stripAndNormalizeToNfc_when_commentHasText", () => {
    expect(normalizeAnswerComment("  cafe\u0301예요.  ")).toBe(
      "café예요.",
    );
  });

  it("should_countUnicodeCodePoints_when_commentContainsEmoji", () => {
    expect(countAnswerCommentCharacters("😀".repeat(200))).toBe(
      200,
    );
  });

  it("should_validateNormalizedLength_when_commentComesFromServer", () => {
    expect(isAnswerCommentValue(null)).toBe(true);
    expect(isAnswerCommentValue("설명이에요.")).toBe(true);
    expect(isAnswerCommentValue(" 설명이에요. ")).toBe(false);
    expect(isAnswerCommentValue("😀".repeat(201))).toBe(false);
  });
});

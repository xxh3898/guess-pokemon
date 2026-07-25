import { describe, expect, it } from "vitest";

import {
  isValidRoomCode,
  normalizeRoomCode,
  validateRoomCode,
} from "./roomCode";

describe("roomCode", () => {
  it("should_trimAndUppercaseCode_when_normalizingInput", () => {
    expect(normalizeRoomCode("  ab3k7m ")).toBe("AB3K7M");
  });

  it("should_acceptSixAllowedCharacters_when_codeIsValid", () => {
    expect(isValidRoomCode("ab3k7m")).toBe(true);
    expect(validateRoomCode("AB3K7M")).toBeNull();
  });

  it("should_rejectAmbiguousCharacters_when_codeContainsExcludedValue", () => {
    expect(isValidRoomCode("ABCI01")).toBe(false);
    expect(validateRoomCode("ABCI01")).toBe(
      "방 코드를 다시 확인해 주세요.",
    );
  });

  it("should_explainExpectedLength_when_codeLengthIsInvalid", () => {
    expect(validateRoomCode("AB12")).toBe(
      "친구에게 받은 방 코드 6자리를 입력해 주세요.",
    );
  });
});

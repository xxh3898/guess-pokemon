import { describe, expect, it } from "vitest";

import {
  normalizeLoginId,
  normalizeNickname,
  validateLogin,
  validateSignup,
} from "./authValidation";

describe("authValidation", () => {
  it("should_normalizeLoginId_when_caseAndWhitespaceDiffer", () => {
    expect(normalizeLoginId("  Trainer_RED  ")).toBe("trainer_red");
  });

  it("should_normalizeNickname_when_unicodeIsDecomposed", () => {
    expect(normalizeNickname("  레드  ")).toBe("레드");
  });

  it("should_acceptSignup_when_valuesMatchBackendRules", () => {
    expect(
      validateSignup({
        loginId: "trainer_red",
        nickname: "레드",
        password: "valid-password-123",
        passwordConfirm: "valid-password-123",
      }),
    ).toEqual({});
  });

  it("should_acceptPassword_when_utf8LengthIsSeventyTwoBytes", () => {
    expect(
      validateSignup({
        loginId: "trainer_red",
        nickname: "레드",
        password: "가".repeat(24),
        passwordConfirm: "가".repeat(24),
      }).password,
    ).toBeUndefined();
  });

  it("should_rejectPassword_when_utf8LengthExceedsSeventyTwoBytes", () => {
    expect(
      validateSignup({
        loginId: "trainer_red",
        nickname: "레드",
        password: "가".repeat(25),
        passwordConfirm: "가".repeat(25),
      }).password,
    ).toBe("비밀번호가 너무 길어요. 조금 짧게 입력해 주세요.");
  });

  it("should_showFriendlyMessage_when_passwordIsTooShort", () => {
    expect(
      validateSignup({
        loginId: "chiho",
        nickname: "치호",
        password: "short",
        passwordConfirm: "short",
      }).password,
    ).toBe("비밀번호가 너무 짧아요. 조금 더 길게 입력해 주세요.");
  });

  it("should_showFriendlyMessage_when_loginIdContainsUnsupportedCharacter", () => {
    expect(
      validateSignup({
        loginId: "chiho!",
        nickname: "치호",
        password: "valid-password-123",
        passwordConfirm: "valid-password-123",
      }).loginId,
    ).toBe("아이디에 사용할 수 없는 문자가 있어요.");
  });

  it("should_rejectNickname_when_formatCharacterExists", () => {
    expect(
      validateSignup({
        loginId: "trainer_red",
        nickname: "레\u200d드",
        password: "valid-password-123",
        passwordConfirm: "valid-password-123",
      }).nickname,
    ).toBe("닉네임에 사용할 수 없는 문자가 포함되어 있어요.");
  });

  it("should_rejectPasswordConfirmation_when_valuesDiffer", () => {
    expect(
      validateSignup({
        loginId: "trainer_red",
        nickname: "레드",
        password: "valid-password-123",
        passwordConfirm: "different-password",
      }).passwordConfirm,
    ).toBe("입력한 비밀번호가 서로 달라요.");
  });

  it("should_onlyRequireCredentials_when_validatingLogin", () => {
    expect(
      validateLogin({
        loginId: "not-a-signup-format",
        password: "short",
      }),
    ).toEqual({});
  });

  it("should_showFriendlyMessage_when_loginPasswordIsTooLong", () => {
    expect(
      validateLogin({
        loginId: "chiho",
        password: "a".repeat(201),
      }).password,
    ).toBe("비밀번호가 너무 길어요. 조금 짧게 입력해 주세요.");
  });
});

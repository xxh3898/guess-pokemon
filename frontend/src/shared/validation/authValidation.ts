export interface LoginValues {
  loginId: string;
  password: string;
}

export interface SignupValues extends LoginValues {
  nickname: string;
  passwordConfirm: string;
}

export type LoginFieldErrors = Partial<
  Record<keyof LoginValues, string>
>;
export type SignupFieldErrors = Partial<
  Record<keyof SignupValues, string>
>;

const LOGIN_ID_PATTERN = /^[a-z0-9_]{4,30}$/;
const FORBIDDEN_NICKNAME_PATTERN = /[<>\p{Cc}\p{Cf}]/u;
const MAX_LOGIN_INPUT_LENGTH = 100;
const MAX_PASSWORD_INPUT_LENGTH = 200;

export function normalizeLoginId(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeNickname(value: string): string {
  return value.trim().normalize("NFC");
}

export function validateLogin(
  values: LoginValues,
): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  if (values.loginId.trim().length === 0) {
    errors.loginId = "아이디를 입력해 주세요.";
  } else if (values.loginId.length > MAX_LOGIN_INPUT_LENGTH) {
    errors.loginId = "아이디가 너무 길어요.";
  }

  if (values.password.length === 0) {
    errors.password = "비밀번호를 입력해 주세요.";
  } else if (values.password.length > MAX_PASSWORD_INPUT_LENGTH) {
    errors.password =
      "비밀번호가 너무 길어요. 조금 짧게 입력해 주세요.";
  }
  return errors;
}

export function validateSignup(
  values: SignupValues,
): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  const loginId = normalizeLoginId(values.loginId);
  if (loginId.length === 0) {
    errors.loginId = "사용할 아이디를 입력해 주세요.";
  } else if (loginId.length < 4 || loginId.length > 30) {
    errors.loginId = "아이디는 4~30자로 입력해 주세요.";
  } else if (!LOGIN_ID_PATTERN.test(loginId)) {
    errors.loginId = "아이디에 사용할 수 없는 문자가 있어요.";
  }

  const passwordBytes = new TextEncoder().encode(values.password).length;
  if (values.password.length === 0) {
    errors.password = "비밀번호를 입력해 주세요.";
  } else if (passwordBytes < 8) {
    errors.password =
      "비밀번호가 너무 짧아요. 조금 더 길게 입력해 주세요.";
  } else if (passwordBytes > 72) {
    errors.password =
      "비밀번호가 너무 길어요. 조금 짧게 입력해 주세요.";
  }
  if (values.passwordConfirm.length === 0) {
    errors.passwordConfirm = "비밀번호를 한 번 더 입력해 주세요.";
  } else if (values.password !== values.passwordConfirm) {
    errors.passwordConfirm = "입력한 비밀번호가 서로 달라요.";
  }

  const nickname = normalizeNickname(values.nickname);
  const nicknameLength = Array.from(nickname).length;
  const nicknameKey = nickname.normalize("NFKC").toLowerCase();
  if (nicknameLength === 0) {
    errors.nickname = "사용할 닉네임을 입력해 주세요.";
  } else if (nicknameLength < 2 || nicknameLength > 16) {
    errors.nickname = "닉네임은 2~16자로 입력해 주세요.";
  } else if (
    nicknameKey.length > 32 ||
    FORBIDDEN_NICKNAME_PATTERN.test(nickname)
  ) {
    errors.nickname =
      "닉네임에 사용할 수 없는 문자가 포함되어 있어요.";
  }
  return errors;
}

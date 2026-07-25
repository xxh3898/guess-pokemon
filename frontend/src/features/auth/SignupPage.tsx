import {
  type ChangeEvent,
  type FormEvent,
  useState,
} from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  UserPlus,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

import { ApiError } from "../../shared/api/HttpClient";
import {
  normalizeLoginId,
  normalizeNickname,
  type SignupFieldErrors,
  type SignupValues,
  validateSignup,
} from "../../shared/validation/authValidation";
import { useAuth } from "./AuthContext";
import { AuthLayout } from "./AuthLayout";

const EMPTY_VALUES: SignupValues = {
  loginId: "",
  nickname: "",
  password: "",
  passwordConfirm: "",
};

export function SignupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<SignupValues>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange =
    (field: keyof SignupValues) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({
        ...current,
        [field]: event.target.value,
      }));
      setFieldErrors((current) => ({
        ...current,
        [field]: undefined,
      }));
      setServerError(null);
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateSignup(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setServerError(null);
      return;
    }

    const loginId = normalizeLoginId(values.loginId);
    setSubmitting(true);
    setServerError(null);
    try {
      await auth.signup({
        loginId,
        nickname: normalizeNickname(values.nickname),
        password: values.password,
      });
      setSubmitting(false);
      navigate("/login", {
        replace: true,
        state: {
          loginId,
          signupComplete: true,
        },
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "LOGIN_ID_ALREADY_EXISTS"
      ) {
        setFieldErrors((current) => ({
          ...current,
          loginId: error.detail,
        }));
      } else if (
        error instanceof ApiError &&
        error.code === "NICKNAME_ALREADY_EXISTS"
      ) {
        setFieldErrors((current) => ({
          ...current,
          nickname: error.detail,
        }));
      } else {
        setServerError(
          error instanceof ApiError
            ? error.detail
            : "회원가입 요청을 처리하지 못했습니다. 다시 시도해 주세요.",
        );
      }
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      description="계정 정보를 입력하면 바로 대전을 준비할 수 있어요."
      eyebrow="처음 오셨나요?"
      footer={
        <p>
          이미 계정이 있나요? <Link to="/login">로그인</Link>
        </p>
      }
      headerActionLabel="로그인"
      headerActionTo="/login"
      title="계정을 만들고 게임을 시작해 보세요"
      variant="signup"
    >
      <div className="auth-card-heading">
        <p className="section-index">SIGN UP</p>
        <h1>회원가입</h1>
        <p>게임에서 사용할 계정을 만들어 주세요.</p>
      </div>

      {serverError ? (
        <div className="form-alert error-alert" role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          {serverError}
        </div>
      ) : null}

      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="signup-login-id">아이디</label>
          <input
            aria-describedby={
              fieldErrors.loginId
                ? "signup-login-id-help signup-login-id-error"
                : "signup-login-id-help"
            }
            aria-invalid={Boolean(fieldErrors.loginId)}
            autoComplete="username"
            id="signup-login-id"
            maxLength={100}
            onChange={handleChange("loginId")}
            placeholder="예: chiho"
            spellCheck={false}
            value={values.loginId}
          />
          <p className="field-help" id="signup-login-id-help">
            로그인할 때 사용할 아이디예요.
          </p>
          {fieldErrors.loginId ? (
            <p className="field-error" id="signup-login-id-error">
              {fieldErrors.loginId}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor="signup-password">비밀번호</label>
          <div className="password-control">
            <input
              aria-describedby={
                fieldErrors.password
                  ? "signup-password-help signup-password-error"
                  : "signup-password-help"
              }
              aria-invalid={Boolean(fieldErrors.password)}
              autoComplete="new-password"
              id="signup-password"
              maxLength={200}
              onChange={handleChange("password")}
              placeholder="비밀번호를 입력해 주세요"
              type={showPassword ? "text" : "password"}
              value={values.password}
            />
            <button
              aria-label={
                showPassword ? "비밀번호 숨기기" : "비밀번호 보기"
              }
              className="password-toggle"
              onClick={() => {
                setShowPassword((visible) => !visible);
              }}
              type="button"
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" size={19} />
              ) : (
                <Eye aria-hidden="true" size={19} />
              )}
            </button>
          </div>
          <p className="field-help" id="signup-password-help">
            다른 사람이 쉽게 알 수 없는 비밀번호를 사용해 주세요.
          </p>
          {fieldErrors.password ? (
            <p className="field-error" id="signup-password-error">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor="signup-password-confirm">비밀번호 확인</label>
          <input
            aria-describedby={
              fieldErrors.passwordConfirm
                ? "signup-password-confirm-error"
                : undefined
            }
            aria-invalid={Boolean(fieldErrors.passwordConfirm)}
            autoComplete="new-password"
            id="signup-password-confirm"
            maxLength={200}
            onChange={handleChange("passwordConfirm")}
            placeholder="비밀번호를 한 번 더 입력해 주세요"
            type={showPassword ? "text" : "password"}
            value={values.passwordConfirm}
          />
          {fieldErrors.passwordConfirm ? (
            <p className="field-error" id="signup-password-confirm-error">
              {fieldErrors.passwordConfirm}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor="signup-nickname">닉네임</label>
          <input
            aria-describedby={
              fieldErrors.nickname
                ? "signup-nickname-help signup-nickname-error"
                : "signup-nickname-help"
            }
            aria-invalid={Boolean(fieldErrors.nickname)}
            autoComplete="nickname"
            id="signup-nickname"
            maxLength={100}
            onChange={handleChange("nickname")}
            placeholder="예: 포켓몬박사"
            value={values.nickname}
          />
          <p className="field-help" id="signup-nickname-help">
            게임에서 상대에게 보이는 이름이에요.
          </p>
          {fieldErrors.nickname ? (
            <p className="field-error" id="signup-nickname-error">
              {fieldErrors.nickname}
            </p>
          ) : null}
        </div>

        <button
          className="primary-button"
          disabled={submitting}
          type="submit"
        >
          <UserPlus aria-hidden="true" size={19} />
          {submitting ? "가입하는 중..." : "가입하기"}
        </button>
      </form>
    </AuthLayout>
  );
}

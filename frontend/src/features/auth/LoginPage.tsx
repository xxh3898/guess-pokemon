import {
  type ChangeEvent,
  type FormEvent,
  useState,
} from "react";
import {
  AlertCircle,
  Eye,
  EyeOff,
  LogIn,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";

import { ApiError } from "../../shared/api/HttpClient";
import {
  normalizeLoginId,
  type LoginFieldErrors,
  type LoginValues,
  validateLogin,
} from "../../shared/validation/authValidation";
import { useAuth } from "./AuthContext";
import { AuthLayout } from "./AuthLayout";
import { safeReturnPath } from "./authNavigation";

const EMPTY_VALUES: LoginValues = {
  loginId: "",
  password: "",
};

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const signupState = readSignupState(location.state);
  const [values, setValues] = useState<LoginValues>({
    ...EMPTY_VALUES,
    loginId: signupState.loginId,
  });
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange =
    (field: keyof LoginValues) =>
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
    const errors = validateLogin(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setServerError(null);
      return;
    }

    setSubmitting(true);
    setServerError(null);
    try {
      await auth.login({
        loginId: normalizeLoginId(values.loginId),
        password: values.password,
      });
      setSubmitting(false);
      navigate(safeReturnPath(location.state) ?? "/lobby", {
        replace: true,
      });
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.detail
          : "로그인 요청을 처리하지 못했습니다. 다시 시도해 주세요.",
      );
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      description="아이디와 비밀번호를 입력하면 대전 로비로 이동해요."
      eyebrow="다시 오신 것을 환영해요"
      footer={
        <p>
          아직 계정이 없나요? <Link to="/signup">회원가입</Link>
        </p>
      }
      headerActionLabel="회원가입"
      headerActionTo="/signup"
      title="다시 만나 반가워요"
      variant="login"
    >
      <div className="auth-card-heading">
        <p className="section-index">LOGIN</p>
        <h1>로그인</h1>
        <p>계속하려면 계정 정보를 입력해 주세요.</p>
      </div>

      {signupState.completed ? (
        <div className="form-alert success-alert" role="status">
          회원가입을 마쳤습니다. 방금 만든 계정으로 로그인해 주세요.
        </div>
      ) : null}
      {serverError ? (
        <div className="form-alert error-alert" role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          {serverError}
        </div>
      ) : null}

      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="login-id">아이디</label>
          <input
            aria-describedby={
              fieldErrors.loginId ? "login-id-error" : undefined
            }
            aria-invalid={Boolean(fieldErrors.loginId)}
            autoComplete="username"
            id="login-id"
            maxLength={100}
            onChange={handleChange("loginId")}
            placeholder="아이디를 입력해 주세요"
            spellCheck={false}
            value={values.loginId}
          />
          {fieldErrors.loginId ? (
            <p className="field-error" id="login-id-error">
              {fieldErrors.loginId}
            </p>
          ) : null}
        </div>

        <div className="form-field">
          <label htmlFor="login-password">비밀번호</label>
          <div className="password-control">
            <input
              aria-describedby={
                fieldErrors.password ? "login-password-error" : undefined
              }
              aria-invalid={Boolean(fieldErrors.password)}
              autoComplete="current-password"
              id="login-password"
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
          {fieldErrors.password ? (
            <p className="field-error" id="login-password-error">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <button
          className="primary-button"
          disabled={submitting}
          type="submit"
        >
          <LogIn aria-hidden="true" size={19} />
          {submitting ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </AuthLayout>
  );
}

function readSignupState(state: unknown): {
  completed: boolean;
  loginId: string;
} {
  if (typeof state !== "object" || state === null) {
    return { completed: false, loginId: "" };
  }
  const candidate = state as Record<string, unknown>;
  return {
    completed: candidate.signupComplete === true,
    loginId:
      typeof candidate.loginId === "string" ? candidate.loginId : "",
  };
}

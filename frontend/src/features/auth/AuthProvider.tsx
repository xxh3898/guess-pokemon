import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApiError } from "../../shared/api/HttpClient";
import {
  type AuthGateway,
  authGateway,
  type CurrentUser,
  type LoginRequest,
  type SignupRequest,
} from "./authApi";
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from "./AuthContext";

interface AuthProviderProps {
  children: ReactNode;
  gateway?: AuthGateway;
}

interface AuthState {
  currentUser: CurrentUser | null;
  error: ApiError | null;
  status: AuthStatus;
}

const ANONYMOUS_STATE: AuthState = {
  currentUser: null,
  error: null,
  status: "anonymous",
};

export function AuthProvider({
  children,
  gateway = authGateway,
}: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    currentUser: null,
    error: null,
    status: "loading",
  });
  const operationGeneration = useRef(0);

  const restoreSession = useCallback(async () => {
    const generation = ++operationGeneration.current;
    setState({
      currentUser: null,
      error: null,
      status: "loading",
    });

    try {
      const currentUser = await gateway.currentUser();
      if (operationGeneration.current === generation) {
        setState({
          currentUser,
          error: null,
          status: "authenticated",
        });
      }
    } catch (error) {
      if (operationGeneration.current !== generation) {
        return;
      }
      const apiError = toApiError(error);
      setState(
        apiError.code === "AUTHENTICATION_REQUIRED"
          ? ANONYMOUS_STATE
          : {
              currentUser: null,
              error: apiError,
              status: "error",
            },
      );
    }
  }, [gateway]);

  useEffect(() => {
    return gateway.subscribeSessionExpired(() => {
      operationGeneration.current += 1;
      gateway.clearSessionSecurity();
      setState(ANONYMOUS_STATE);
    });
  }, [gateway]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const login = useCallback(
    async (request: LoginRequest) => {
      const generation = ++operationGeneration.current;
      await gateway.login(request);
      const currentUser = await gateway.currentUser();
      if (operationGeneration.current === generation) {
        setState({
          currentUser,
          error: null,
          status: "authenticated",
        });
      }
      return currentUser;
    },
    [gateway],
  );

  const signup = useCallback(
    (request: SignupRequest) => gateway.signup(request),
    [gateway],
  );

  const logout = useCallback(async () => {
    const generation = ++operationGeneration.current;
    await gateway.logout();
    if (operationGeneration.current === generation) {
      gateway.clearSessionSecurity();
      setState(ANONYMOUS_STATE);
    }
  }, [gateway]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      restoreSession,
      signup,
    }),
    [login, logout, restoreSession, signup, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : ApiError.invalidResponse();
}

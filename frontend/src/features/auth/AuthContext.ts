import { createContext, useContext } from "react";

import type { ApiError } from "../../shared/api/HttpClient";
import type {
  CurrentUser,
  LoginRequest,
  SignupRequest,
  UserSummary,
} from "./authApi";

export type AuthStatus =
  | "anonymous"
  | "authenticated"
  | "error"
  | "loading";

export interface AuthContextValue {
  currentUser: CurrentUser | null;
  error: ApiError | null;
  login(request: LoginRequest): Promise<CurrentUser>;
  logout(): Promise<void>;
  restoreSession(): Promise<void>;
  setActiveRoomCode(roomCode: string | null): void;
  signup(request: SignupRequest): Promise<UserSummary>;
  status: AuthStatus;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("AuthProvider 안에서 useAuth를 사용해야 합니다.");
  }
  return context;
}

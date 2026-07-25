import { vi } from "vitest";

import type { AuthContextValue } from "../features/auth/AuthContext";
import type { CurrentUser } from "../features/auth/authApi";

export const TEST_CURRENT_USER: CurrentUser = {
  activeRoomCode: null,
  user: {
    id: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
    loginId: "trainer_red",
    nickname: "레드",
  },
};

export function createAuthContextValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    currentUser: null,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    restoreSession: vi.fn(),
    setActiveRoomCode: vi.fn(),
    signup: vi.fn(),
    status: "anonymous",
    ...overrides,
  };
}

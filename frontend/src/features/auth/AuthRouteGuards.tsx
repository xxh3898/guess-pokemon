import {
  Navigate,
  Outlet,
  useLocation,
} from "react-router";

import { PageStatus } from "../../shared/ui/PageStatus";
import { useAuth } from "./AuthContext";
import {
  currentLocationPath,
  safeReturnPath,
} from "./authNavigation";

export function AuthenticatedRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "loading") {
    return (
      <PageStatus
        detail="안전한 로그인 상태를 확인하고 있습니다."
        loading
        title="로그인 상태를 확인하고 있어요"
      />
    );
  }
  if (auth.status === "error") {
    return (
      <PageStatus
        detail={
          auth.error?.detail ??
          "로그인 상태를 확인하지 못했습니다."
        }
        onRetry={() => {
          void auth.restoreSession();
        }}
        title="로그인 상태를 확인하지 못했어요"
      />
    );
  }
  if (auth.status === "anonymous") {
    return (
      <Navigate
        replace
        state={{ from: currentLocationPath(location) }}
        to="/login"
      />
    );
  }
  return <Outlet />;
}

export function AnonymousOnlyRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "loading") {
    return (
      <PageStatus
        detail="로그인 상태를 확인한 뒤 화면을 열어드릴게요."
        loading
        title="잠시만 기다려 주세요"
      />
    );
  }
  if (auth.status === "error") {
    return (
      <PageStatus
        detail={
          auth.error?.detail ??
          "로그인 상태를 확인하지 못했습니다."
        }
        onRetry={() => {
          void auth.restoreSession();
        }}
        title="로그인 상태를 확인하지 못했어요"
      />
    );
  }
  if (auth.status === "authenticated") {
    return (
      <Navigate
        replace
        to={safeReturnPath(location.state) ?? "/lobby"}
      />
    );
  }
  return <Outlet />;
}

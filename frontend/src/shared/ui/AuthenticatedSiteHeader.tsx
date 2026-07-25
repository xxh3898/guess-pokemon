import {
  CircleHelp,
  Gamepad2,
  History,
  LogOut,
  Menu,
  UserRound,
  X,
} from "lucide-react";
import {
  type FocusEvent,
  useEffect,
  useState,
} from "react";
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
} from "react-router";

import { useAuth } from "../../features/auth/AuthContext";
import { ApiError } from "../api/HttpClient";

interface AuthenticatedSiteHeaderProps {
  activePage: "history" | "lobby";
}

export function AuthenticatedSiteHeader({
  activePage,
}: AuthenticatedSiteHeaderProps) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const user = auth.currentUser?.user;
  if (!user) {
    return null;
  }

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await auth.logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(
        error instanceof ApiError
          ? error.detail
          : "로그아웃 요청을 처리하지 못했습니다. 다시 시도해 주세요.",
      );
      setLoggingOut(false);
    }
  };

  const closeWhenFocusLeaves = (
    event: FocusEvent<HTMLElement>,
  ) => {
    if (
      menuOpen &&
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setMenuOpen(false);
    }
  };

  return (
    <>
      <header
        className="site-header authenticated-site-header"
        onBlur={closeWhenFocusLeaves}
      >
        <button
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
          className="mobile-menu-button"
          onClick={() => {
            setMenuOpen((open) => !open);
          }}
          type="button"
        >
          {menuOpen ? (
            <X aria-hidden="true" size={22} />
          ) : (
            <Menu aria-hidden="true" size={22} />
          )}
        </button>

        <Link className="brand-link authenticated-brand-link" to="/">
          <span className="brand-link-mark" aria-hidden="true">
            <CircleHelp size={24} strokeWidth={2.4} />
          </span>
          <span>Guess Pokémon</span>
        </Link>

        <nav aria-label="주요 메뉴" className="authenticated-nav">
          <NavLink
            aria-current={
              activePage === "lobby" ? "page" : undefined
            }
            className={({ isActive }) =>
              `authenticated-nav-item ${
                isActive ? "is-active" : ""
              }`.trim()
            }
            end
            to="/lobby"
          >
            <Gamepad2 aria-hidden="true" size={17} />
            로비
          </NavLink>
          <NavLink
            aria-current={
              activePage === "history" ? "page" : undefined
            }
            className={({ isActive }) =>
              `authenticated-nav-item ${
                isActive ? "is-active" : ""
              }`.trim()
            }
            to="/history"
          >
            <History aria-hidden="true" size={17} />
            경기 기록
          </NavLink>
        </nav>

        <div className="authenticated-header-actions">
          <div className="profile-chip">
            <UserRound aria-hidden="true" size={18} />
            <span>{user.nickname}</span>
          </div>
          <button
            className="logout-button desktop-logout-button"
            disabled={loggingOut}
            onClick={() => {
              void handleLogout();
            }}
            type="button"
          >
            <LogOut aria-hidden="true" size={18} />
            {loggingOut ? "로그아웃 중..." : "로그아웃"}
          </button>
        </div>

        {menuOpen ? (
          <nav
            aria-label="모바일 메뉴"
            className="authenticated-mobile-menu"
          >
            <NavLink
              aria-current={
                activePage === "lobby" ? "page" : undefined
              }
              className="mobile-menu-link"
              end
              onClick={() => {
                setMenuOpen(false);
              }}
              to="/lobby"
            >
              <Gamepad2 aria-hidden="true" size={18} />
              로비
            </NavLink>
            <NavLink
              aria-current={
                activePage === "history" ? "page" : undefined
              }
              className="mobile-menu-link"
              onClick={() => {
                setMenuOpen(false);
              }}
              to="/history"
            >
              <History aria-hidden="true" size={18} />
              경기 기록
            </NavLink>
            <button
              className="mobile-menu-logout"
              disabled={loggingOut}
              onClick={() => {
                void handleLogout();
              }}
              type="button"
            >
              <LogOut aria-hidden="true" size={18} />
              {loggingOut ? "로그아웃 중..." : "로그아웃"}
            </button>
          </nav>
        ) : null}
      </header>
      {logoutError ? (
        <div className="header-logout-error" role="alert">
          {logoutError}
        </div>
      ) : null}
    </>
  );
}

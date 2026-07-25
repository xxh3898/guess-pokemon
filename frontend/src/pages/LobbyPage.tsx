import { useState } from "react";
import {
  Clock3,
  CircleHelp,
  Gamepad2,
  History,
  LogOut,
  Plus,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Link, useNavigate } from "react-router";

import { useAuth } from "../features/auth/AuthContext";
import { ApiError } from "../shared/api/HttpClient";
import { PageStatus } from "../shared/ui/PageStatus";

export function LobbyPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  if (!auth.currentUser) {
    return (
      <PageStatus
        detail="사용자 정보를 다시 확인해 주세요."
        onRetry={() => {
          void auth.restoreSession();
        }}
        title="로비 정보를 불러오지 못했어요"
      />
    );
  }

  const { activeRoomCode, user } = auth.currentUser;

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await auth.logout();
      setLoggingOut(false);
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

  return (
    <main className="site-page lobby-page">
      <div className="site-frame lobby-frame">
        <header className="site-header">
          <Link className="brand-link" to="/">
            <span className="brand-link-mark" aria-hidden="true">
              <CircleHelp size={24} strokeWidth={2.4} />
            </span>
            Guess Pokémon
          </Link>

          <nav aria-label="주요 메뉴" className="lobby-nav">
            <span aria-current="page" className="lobby-nav-item is-active">
              <Gamepad2 aria-hidden="true" size={17} />
              로비
            </span>
            <span className="lobby-nav-item is-disabled">
              <History aria-hidden="true" size={17} />
              경기 기록
            </span>
          </nav>

          <div className="header-actions">
            <div className="profile-chip">
              <UserRound aria-hidden="true" size={18} />
              <span>{user.nickname}</span>
            </div>
            <button
              className="logout-button"
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
        </header>

        <section className="lobby-content" aria-labelledby="lobby-title">
          <div className="lobby-heading">
            <p className="section-kicker">READY TO PLAY</p>
            <h1 id="lobby-title">대전 준비</h1>
            <p>
              {user.nickname}님, 새 방을 만들거나 친구의 방 코드로
              입장해 대전을 시작해 보세요.
            </p>
          </div>

          {logoutError ? (
            <div className="form-alert error-alert" role="alert">
              {logoutError}
            </div>
          ) : null}

          {activeRoomCode ? (
            <article className="active-room-card">
              <span className="step-number yellow-number">03</span>
              <div>
                <p className="card-caption">참여 중인 방</p>
                <h2 className="room-code">{activeRoomCode}</h2>
                <p>진행 중인 방 정보가 계정에 남아 있어요.</p>
              </div>
              <Gamepad2 aria-hidden="true" size={36} />
            </article>
          ) : null}

          <div className="lobby-grid">
            <article className="lobby-action-card create-room-card">
              <div className="lobby-card-heading">
                <span className="step-number">01</span>
                <UsersRound aria-hidden="true" size={34} />
              </div>
              <div>
                <h2>새 방 만들기</h2>
                <p>새로운 방을 만들고 친구에게 방 코드를 알려주세요.</p>
              </div>
              <button className="primary-button" disabled type="button">
                <Plus aria-hidden="true" size={18} />
                다음 단계에서 연결
              </button>
            </article>

            <article className="lobby-action-card join-room-card">
              <div className="lobby-card-heading">
                <span className="step-number mint-number">02</span>
                <Search aria-hidden="true" size={34} />
              </div>
              <div>
                <h2>방 코드로 입장</h2>
                <p>친구에게 받은 6자리 방 코드로 참여할 수 있어요.</p>
              </div>
              <button className="mint-button" disabled type="button">
                <Search aria-hidden="true" size={18} />
                다음 단계에서 연결
              </button>
            </article>
          </div>

          <aside className="lobby-coming-soon">
            <History aria-hidden="true" size={22} />
            <div>
              <strong>경기 기록 화면도 준비하고 있어요.</strong>
              <p>완료한 경기의 질문과 추측을 다음 화면 작업에서 연결합니다.</p>
            </div>
            <Clock3 aria-hidden="true" size={20} />
          </aside>

          <p className="account-note">
            아이디 <strong>{user.loginId}</strong>
          </p>
        </section>
      </div>
    </main>
  );
}

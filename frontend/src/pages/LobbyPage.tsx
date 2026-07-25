import {
  AlertCircle,
  LoaderCircle,
  Plus,
  Play,
  Search,
  UsersRound,
} from "lucide-react";
import {
  type FormEvent,
  useState,
} from "react";
import { Link, useNavigate } from "react-router";

import { useAuth } from "../features/auth/AuthContext";
import {
  type RoomGateway,
  roomGateway,
} from "../features/room/roomApi";
import {
  validateRoomCode,
} from "../features/room/roomCode";
import { ApiError } from "../shared/api/HttpClient";
import { AuthenticatedSiteHeader } from "../shared/ui/AuthenticatedSiteHeader";
import { PageStatus } from "../shared/ui/PageStatus";

interface LobbyPageProps {
  gateway?: RoomGateway;
}

export function LobbyPage({
  gateway = roomGateway,
}: LobbyPageProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");

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
  const roomActionDisabled =
    creatingRoom || joiningRoom || activeRoomCode !== null;

  const handleCreateRoom = async () => {
    if (roomActionDisabled) {
      return;
    }
    setCreatingRoom(true);
    setCreateError(null);
    try {
      const snapshot = await gateway.create();
      auth.setActiveRoomCode(snapshot.roomCode);
      navigate(`/rooms/${snapshot.roomCode}`);
    } catch (error) {
      setCreateError(roomActionError(error));
      setCreatingRoom(false);
    }
  };

  const handleJoinRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (roomActionDisabled) {
      return;
    }
    const validationMessage = validateRoomCode(roomCode);
    if (validationMessage) {
      setJoinError(validationMessage);
      return;
    }

    setJoiningRoom(true);
    setJoinError(null);
    try {
      const snapshot = await gateway.join(roomCode);
      auth.setActiveRoomCode(snapshot.roomCode);
      navigate(`/rooms/${snapshot.roomCode}`);
    } catch (error) {
      setJoinError(roomActionError(error));
      setJoiningRoom(false);
    }
  };

  return (
    <main className="site-page lobby-page">
      <div className="site-frame lobby-frame">
        <AuthenticatedSiteHeader activePage="lobby" />

        <section className="lobby-content" aria-labelledby="lobby-title">
          <div className="lobby-heading">
            <p className="section-kicker">READY TO PLAY</p>
            <h1 id="lobby-title">대전 준비</h1>
            <p>
              {user.nickname}님, 새 방을 만들거나 친구의 방 코드로
              입장해 대전을 시작해 보세요.
            </p>
          </div>

          {activeRoomCode ? (
            <article className="active-room-card">
              <span className="step-number yellow-number">03</span>
              <div className="active-room-summary">
                <p className="card-caption">참여 중인 방</p>
                <h2 className="room-code">{activeRoomCode}</h2>
                <p>이어갈 수 있는 방이 있어요.</p>
              </div>
              <Link
                className="active-room-link"
                to={`/rooms/${activeRoomCode}`}
              >
                <Play aria-hidden="true" size={17} />
                이어서 하기
              </Link>
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
              {createError ? (
                <div className="card-error-message" role="alert">
                  <AlertCircle aria-hidden="true" size={17} />
                  {createError}
                </div>
              ) : null}
              <button
                className="primary-button"
                disabled={roomActionDisabled}
                onClick={() => {
                  void handleCreateRoom();
                }}
                type="button"
              >
                {creatingRoom ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="spin-icon"
                    size={18}
                  />
                ) : (
                  <Plus aria-hidden="true" size={18} />
                )}
                {creatingRoom ? "방 만드는 중..." : "방 만들기"}
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
              <form
                className="room-join-form"
                onSubmit={(event) => {
                  void handleJoinRoom(event);
                }}
              >
                <label htmlFor="room-code">방 코드</label>
                <input
                  aria-describedby={
                    joinError ? "room-code-error" : undefined
                  }
                  aria-invalid={joinError !== null}
                  autoCapitalize="characters"
                  autoComplete="off"
                  disabled={roomActionDisabled}
                  id="room-code"
                  onChange={(event) => {
                    setRoomCode(event.target.value.toUpperCase());
                    setJoinError(null);
                  }}
                  placeholder="예: ABCD12"
                  spellCheck={false}
                  value={roomCode}
                />
                {joinError ? (
                  <p
                    className="field-error-message"
                    id="room-code-error"
                    role="alert"
                  >
                    <AlertCircle aria-hidden="true" size={16} />
                    {joinError}
                  </p>
                ) : null}
                <button
                  className="mint-button"
                  disabled={roomActionDisabled}
                  type="submit"
                >
                  {joiningRoom ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="spin-icon"
                      size={18}
                    />
                  ) : (
                    <Search aria-hidden="true" size={18} />
                  )}
                  {joiningRoom ? "입장하는 중..." : "입장하기"}
                </button>
              </form>
            </article>
          </div>

          {activeRoomCode ? (
            <p className="active-room-guidance">
              새 방을 만들거나 다른 방에 들어가려면 참여 중인 방을
              먼저 확인해 주세요.
            </p>
          ) : null}

          <p className="account-note">
            아이디 <strong>{user.loginId}</strong>
          </p>
        </section>
      </div>
    </main>
  );
}

function roomActionError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  return "방 요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

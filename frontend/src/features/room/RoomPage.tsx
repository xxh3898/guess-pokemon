import {
  Check,
  CircleHelp,
  Clock3,
  Copy,
  DoorOpen,
  Info,
  LoaderCircle,
  Radio,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router";

import { useAuth } from "../auth/AuthContext";
import {
  type RoomGateway,
  roomGateway,
} from "./roomApi";
import {
  isValidRoomCode,
  normalizeRoomCode,
} from "./roomCode";
import {
  applyAuthoritativeSnapshot,
  applyWaitingRoomEvent,
} from "./roomState";
import type {
  RoomMember,
  WaitingRoomSnapshot,
} from "./roomTypes";
import {
  ApiError,
} from "../../shared/api/HttpClient";
import {
  type RealtimeConnectionStatus,
  type RoomRealtimeGateway,
  type RoomRealtimeSession,
  roomRealtimeGateway,
} from "../../shared/realtime/RoomRealtimeGateway";
import type { WaitingRoomEvent } from "../../shared/realtime/realtimeTypes";
import type { RoomClosedReason } from "../../shared/realtime/realtimeTypes";
import { PageStatus } from "../../shared/ui/PageStatus";

type ClipboardWriter = (value: string) => Promise<void>;

interface RoomPageProps {
  gateway?: RoomGateway;
  realtimeGateway?: RoomRealtimeGateway;
  writeClipboard?: ClipboardWriter;
}

export function RoomPage({
  gateway = roomGateway,
  realtimeGateway = roomRealtimeGateway,
  writeClipboard = defaultClipboardWriter,
}: RoomPageProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { roomCode: routeRoomCode = "" } = useParams();
  const roomCode = normalizeRoomCode(routeRoomCode);
  const validRoomCode = isValidRoomCode(roomCode);
  const [snapshot, setSnapshot] =
    useState<WaitingRoomSnapshot | null>(null);
  const [loading, setLoading] = useState(validRoomCode);
  const [loadError, setLoadError] = useState<string | null>(
    validRoomCode ? null : "방 코드 6자리를 다시 확인해 주세요.",
  );
  const [realtimeError, setRealtimeError] = useState<string | null>(
    null,
  );
  const [connectionStatus, setConnectionStatus] =
    useState<RealtimeConnectionStatus>("connecting");
  const [announcement, setAnnouncement] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [roomClosedReason, setRoomClosedReason] =
    useState<RoomClosedReason | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const previousOpponentRef = useRef<{
    member: RoomMember | null;
    roomCode: string;
  } | null>(null);
  const setActiveRoomCode = auth.setActiveRoomCode;

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const previous = previousOpponentRef.current;
    if (
      previous?.roomCode === snapshot.roomCode &&
      previous.member &&
      !snapshot.opponent
    ) {
      setAnnouncement(
        `${previous.member.nickname}님이 방을 나갔어요.`,
      );
    }
    previousOpponentRef.current = {
      member: snapshot.opponent,
      roomCode: snapshot.roomCode,
    };
  }, [snapshot]);

  useEffect(() => {
    if (!validRoomCode) {
      return;
    }

    let active = true;
    let closedByServer = false;
    const abortController = new AbortController();
    let realtimeSession: RoomRealtimeSession | null = null;
    setLoading(true);
    setLoadError(null);
    setRealtimeError(null);

    const handleEvent = (event: WaitingRoomEvent) => {
      if (!active || event.roomCode !== roomCode) {
        return;
      }
      if (event.eventType === "PLAYER_JOINED") {
        setAnnouncement(
          `${event.payload.player.nickname}님이 방에 입장했어요.`,
        );
      }
      if (event.eventType === "ROOM_CLOSED") {
        closedByServer = true;
        abortController.abort();
        setActiveRoomCode(null);
        setRoomClosedReason(event.payload.reason);
        return;
      }
      setSnapshot((current) =>
        applyWaitingRoomEvent(current, event),
      );
    };

    try {
      realtimeSession = realtimeGateway.open(roomCode, {
        onEvent: handleEvent,
        onRealtimeError: (error) => {
          if (active) {
            setRealtimeError(error.message);
          }
        },
        onStatusChange: (status) => {
          if (!active) {
            return;
          }
          setConnectionStatus(status);
          if (status === "connected") {
            setRealtimeError(null);
          }
        },
        onTransportError: (detail) => {
          if (active) {
            setRealtimeError(detail);
          }
        },
      });
    } catch (error) {
      setRealtimeError(toSafeDetail(error));
    }

    void gateway
      .get(roomCode, abortController.signal)
      .then((roomSnapshot) => {
        if (!active || closedByServer) {
          return;
        }
        setSnapshot((current) =>
          applyAuthoritativeSnapshot(current, roomSnapshot),
        );
        setActiveRoomCode(roomSnapshot.roomCode);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) {
          return;
        }
        setLoadError(toSafeDetail(error));
        setLoading(false);
      });

    return () => {
      active = false;
      abortController.abort();
      if (realtimeSession) {
        void realtimeSession.close();
      }
    };
  }, [
    gateway,
    realtimeGateway,
    reloadKey,
    roomCode,
    setActiveRoomCode,
    validRoomCode,
  ]);

  const copyRoomCode = async () => {
    setCopyFeedback("");
    try {
      await writeClipboard(roomCode);
      setCopyFeedback("방 코드를 복사했어요.");
    } catch {
      setCopyFeedback(
        "복사하지 못했습니다. 방 코드를 직접 선택해 주세요.",
      );
    }
  };

  const leaveRoom = async () => {
    if (leaving) {
      return;
    }
    setLeaving(true);
    setLeaveError(null);
    try {
      await gateway.leave(roomCode);
      setActiveRoomCode(null);
      navigate("/lobby", { replace: true });
    } catch (error) {
      setLeaveError(toSafeDetail(error));
      setLeaving(false);
    }
  };

  if (!validRoomCode) {
    return (
      <PageStatus
        backLink={{ label: "로비로 돌아가기", to: "/lobby" }}
        detail="주소에 있는 방 코드가 올바른지 확인해 주세요."
        title="방 코드를 확인해 주세요"
      />
    );
  }
  if (roomClosedReason) {
    return (
      <PageStatus
        backLink={{ label: "로비로 돌아가기", to: "/lobby" }}
        detail={
          roomClosedReason === "HOST_LEFT"
            ? "방장이 방을 나가 대기방을 종료했어요."
            : "참가자가 결과 화면에서 나가 방이 종료됐어요."
        }
        title="방이 종료됐어요"
      />
    );
  }
  if (loading && !snapshot) {
    return (
      <PageStatus
        detail="방 상태와 실시간 연결을 안전하게 확인하고 있어요."
        loading
        title="대기방을 불러오고 있어요"
      />
    );
  }
  if (loadError && !snapshot) {
    return (
      <PageStatus
        backLink={{ label: "로비로 돌아가기", to: "/lobby" }}
        detail={loadError}
        onRetry={() => {
          setReloadKey((current) => current + 1);
        }}
        title="대기방을 불러오지 못했어요"
      />
    );
  }
  if (!snapshot) {
    return (
      <PageStatus
        backLink={{ label: "로비로 돌아가기", to: "/lobby" }}
        detail="잠시 뒤 다시 시도해 주세요."
        title="방 상태를 확인하지 못했어요"
      />
    );
  }

  const selector = memberByRole(snapshot, "SELECTOR");
  const questioner = memberByRole(snapshot, "QUESTIONER");
  const waitingForOpponent =
    snapshot.status === "WAITING_FOR_OPPONENT";

  return (
    <main className="site-page room-page">
      <div className="site-frame room-frame">
        <header className="room-header">
          <Link className="brand-link" to="/">
            <span className="brand-link-mark" aria-hidden="true">
              <CircleHelp size={24} strokeWidth={2.4} />
            </span>
            Guess Pokémon
          </Link>

          <div className="room-header-code">
            <span>방 코드</span>
            <strong className="room-code">{roomCode}</strong>
            <button
              aria-label="방 코드 복사"
              onClick={() => {
                void copyRoomCode();
              }}
              type="button"
            >
              <Copy aria-hidden="true" size={17} />
            </button>
          </div>

          <ConnectionBadge status={connectionStatus} />
        </header>

        <section className="room-content" aria-labelledby="room-title">
          <div className="room-status-heading">
            <span className="room-status-icon" aria-hidden="true">
              <Clock3 size={25} />
            </span>
            <div>
              <p className="section-kicker">
                ROUND {snapshot.roundNumber}
              </p>
              <h1 id="room-title">
                {waitingForOpponent
                  ? "상대를 기다리는 중"
                  : "정답 선택을 준비하고 있어요"}
              </h1>
              <p>
                {waitingForOpponent
                  ? "친구가 입장하면 정답 포켓몬 선택 단계로 이동해요."
                  : selectionWaitingCopy(snapshot.me.role)}
              </p>
            </div>
          </div>

          <p
            aria-live="polite"
            className="room-live-region"
          >
            {announcement}
          </p>

          {realtimeError ? (
            <div className="room-inline-alert" role="alert">
              <WifiOff aria-hidden="true" size={18} />
              <span>{realtimeError}</span>
            </div>
          ) : null}

          <div className="participant-grid">
            <ParticipantCard
              index="1"
              isMe={selector?.userId === snapshot.me.userId}
              member={selector}
              role="출제자"
              tone="blue"
            />
            <ParticipantCard
              index="2"
              isMe={questioner?.userId === snapshot.me.userId}
              member={questioner}
              role="질문자"
              tone="mint"
            />
          </div>

          <div className="room-share-card">
            <span className="room-share-icon" aria-hidden="true">
              <UsersRound size={27} />
            </span>
            <div>
              <h2>방 코드를 친구에게 알려 주세요</h2>
              <p>같은 방에 입장하면 역할을 나눠 대전을 시작해요.</p>
            </div>
            <div className="room-copy-box">
              <span>방 코드</span>
              <strong className="room-code">{roomCode}</strong>
              <button
                aria-label="친구에게 보낼 방 코드 복사"
                onClick={() => {
                  void copyRoomCode();
                }}
                type="button"
              >
                <Copy aria-hidden="true" size={18} />
              </button>
            </div>
          </div>

          <p
            aria-live="polite"
            className="room-copy-feedback"
          >
            {copyFeedback ? (
              <>
                <Check aria-hidden="true" size={16} />
                {copyFeedback}
              </>
            ) : null}
          </p>

          <div className="room-expiry-note">
            <Info aria-hidden="true" size={18} />
            {waitingForOpponent
              ? "30분 동안 상대가 입장하지 않으면 방이 닫혀요."
              : "두 참가자가 모두 입장했어요. 다음 단계에서 포켓몬을 선택합니다."}
          </div>

          {leaveError ? (
            <div className="room-inline-alert" role="alert">
              <Info aria-hidden="true" size={18} />
              <span>{leaveError}</span>
            </div>
          ) : null}

          <button
            className="room-leave-button"
            disabled={leaving}
            onClick={() => {
              void leaveRoom();
            }}
            type="button"
          >
            {leaving ? (
              <LoaderCircle
                aria-hidden="true"
                className="spin-icon"
                size={19}
              />
            ) : (
              <DoorOpen aria-hidden="true" size={19} />
            )}
            {leaving ? "방 나가는 중..." : "방 나가기"}
          </button>
        </section>
      </div>
    </main>
  );
}

interface ParticipantCardProps {
  index: string;
  isMe: boolean;
  member: RoomMember | null;
  role: string;
  tone: "blue" | "mint";
}

function ParticipantCard({
  index,
  isMe,
  member,
  role,
  tone,
}: ParticipantCardProps) {
  return (
    <article className={`participant-card ${tone}-participant`}>
      <span className="participant-index">{index}</span>
      <span className="participant-avatar" aria-hidden="true">
        <UserRound size={50} strokeWidth={1.7} />
      </span>
      <div className="participant-copy">
        <h2>{member?.nickname ?? "친구를 기다리고 있어요"}</h2>
        {member ? (
          <>
            <p className="participant-role">
              {role}
              {isMe ? <span>나</span> : null}
            </p>
            <p
              className={
                member.connected
                  ? "member-connected"
                  : "member-disconnected"
              }
            >
              {member.connected ? (
                <Wifi aria-hidden="true" size={15} />
              ) : (
                <WifiOff aria-hidden="true" size={15} />
              )}
              {member.connected ? "연결됨" : "연결 끊김"}
            </p>
          </>
        ) : (
          <p>방 코드를 알려주면 이 자리에 친구가 표시돼요.</p>
        )}
      </div>
    </article>
  );
}

function ConnectionBadge({
  status,
}: {
  status: RealtimeConnectionStatus;
}) {
  const connected = status === "connected";
  return (
    <div
      className={`connection-badge ${
        connected ? "is-connected" : "is-connecting"
      }`}
      role="status"
    >
      {connected ? (
        <Radio aria-hidden="true" size={17} />
      ) : (
        <LoaderCircle
          aria-hidden="true"
          className="spin-icon"
          size={17}
        />
      )}
      {connected
        ? "연결됨"
        : status === "reconnecting"
          ? "재연결 중"
          : "연결 중"}
    </div>
  );
}

function memberByRole(
  snapshot: WaitingRoomSnapshot,
  role: RoomMember["role"],
): RoomMember | null {
  if (snapshot.me.role === role) {
    return snapshot.me;
  }
  if (snapshot.opponent?.role === role) {
    return snapshot.opponent;
  }
  return null;
}

function selectionWaitingCopy(role: RoomMember["role"]): string {
  return role === "SELECTOR"
    ? "다음 단계에서 정답 포켓몬을 선택할 수 있어요."
    : "출제자가 정답 포켓몬을 선택하면 질문을 시작해요.";
}

function toSafeDetail(error: unknown): string {
  return error instanceof ApiError
    ? error.detail
    : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function defaultClipboardWriter(value: string): Promise<void> {
  if (!globalThis.navigator.clipboard) {
    return Promise.reject(new Error("Clipboard API unavailable"));
  }
  return globalThis.navigator.clipboard.writeText(value);
}

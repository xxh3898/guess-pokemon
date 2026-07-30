import {
  AlertCircle,
  LoaderCircle,
  RefreshCw,
  UserRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ApiError } from "../../shared/api/HttpClient";
import type { RoomGateway } from "./roomApi";
import type {
  JoinableRoomSummary,
} from "./joinableRoomTypes";

const ROOM_LIST_POLL_INTERVAL_MS = 5_000;
const STALE_ROOM_ERROR_CODES = new Set([
  "ROOM_EXPIRED",
  "ROOM_FULL",
  "ROOM_NOT_FOUND",
]);

interface JoinableRoomListProps {
  disabled: boolean;
  gateway: RoomGateway;
  onJoined(roomCode: string): void;
  onJoiningChange(joining: boolean): void;
}

interface JoinError {
  readonly message: string;
  readonly roomCode: string;
}

export function JoinableRoomList({
  disabled,
  gateway,
  onJoined,
  onJoiningChange,
}: JoinableRoomListProps) {
  const [rooms, setRooms] =
    useState<readonly JoinableRoomSummary[] | null>(null);
  const [listError, setListError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [joiningRoomCode, setJoiningRoomCode] =
    useState<string | null>(null);
  const [joinError, setJoinError] = useState<JoinError | null>(
    null,
  );
  const listControllerRef = useRef<AbortController | null>(null);
  const listRequestRef = useRef<Promise<void> | null>(null);
  const joinControllerRef = useRef<AbortController | null>(null);

  const requestRooms = useCallback((): Promise<void> => {
    if (listRequestRef.current) {
      return listRequestRef.current;
    }

    const controller = new AbortController();
    listControllerRef.current = controller;
    setRefreshing(true);

    let trackedRequest: Promise<void>;
    trackedRequest = gateway
      .list(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setRooms(response.rooms);
        setListError(false);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setListError(true);
        }
      })
      .finally(() => {
        if (listRequestRef.current !== trackedRequest) {
          return;
        }
        listRequestRef.current = null;
        listControllerRef.current = null;
        if (!controller.signal.aborted) {
          setRefreshing(false);
        }
      });
    listRequestRef.current = trackedRequest;
    return trackedRequest;
  }, [gateway]);

  useEffect(() => {
    void requestRooms();
    const pollTimer = globalThis.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void requestRooms();
      }
    }, ROOM_LIST_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") {
        void requestRooms();
      }
    };
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      globalThis.clearInterval(pollTimer);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      listControllerRef.current?.abort();
      listControllerRef.current = null;
      listRequestRef.current = null;
    };
  }, [requestRooms]);

  useEffect(
    () => () => {
      joinControllerRef.current?.abort();
      joinControllerRef.current = null;
    },
    [],
  );

  const handleJoin = async (room: JoinableRoomSummary) => {
    if (disabled || joiningRoomCode !== null) {
      return;
    }

    const controller = new AbortController();
    joinControllerRef.current = controller;
    setJoiningRoomCode(room.roomCode);
    setJoinError(null);
    onJoiningChange(true);
    let joinedRoomCode: string | null = null;

    try {
      const snapshot = await gateway.join(
        room.roomCode,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        joinedRoomCode = snapshot.roomCode;
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }
      setJoinError({
        message: listedRoomJoinError(error),
        roomCode: room.roomCode,
      });
      if (isStaleRoomError(error)) {
        if (listRequestRef.current) {
          await listRequestRef.current;
        }
        await requestRooms();
      }
    } finally {
      if (joinControllerRef.current === controller) {
        joinControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setJoiningRoomCode(null);
        onJoiningChange(false);
      }
    }

    if (joinedRoomCode !== null) {
      onJoined(joinedRoomCode);
    }
  };

  const joinErrorShownInRow =
    joinError !== null &&
    rooms?.some(({ roomCode }) => roomCode === joinError.roomCode);

  return (
    <section
      aria-labelledby="joinable-room-list-title"
      className="joinable-room-section"
    >
      <div className="joinable-room-heading">
        <div className="joinable-room-title">
          <span className="step-number">04</span>
          <div>
            <h2 id="joinable-room-list-title">참가 가능한 방</h2>
            <p>지금 입장할 수 있는 대기방이에요.</p>
          </div>
        </div>
        <button
          className="joinable-room-refresh"
          disabled={refreshing}
          onClick={() => {
            setJoinError(null);
            void requestRooms();
          }}
          type="button"
        >
          {refreshing ? (
            <LoaderCircle
              aria-hidden="true"
              className="spin-icon"
              size={16}
            />
          ) : (
            <RefreshCw aria-hidden="true" size={16} />
          )}
          새로고침
        </button>
      </div>

      {joinError && !joinErrorShownInRow ? (
        <p className="joinable-room-notice" role="alert">
          <AlertCircle aria-hidden="true" size={17} />
          {joinError.message}
        </p>
      ) : null}

      {rooms === null && !listError ? (
        <div className="joinable-room-state" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="spin-icon"
            size={24}
          />
          참가 가능한 방을 불러오고 있어요.
        </div>
      ) : rooms === null ? (
        <div className="joinable-room-state is-error" role="alert">
          <AlertCircle aria-hidden="true" size={25} />
          <strong>방 목록을 불러오지 못했어요.</strong>
          <button
            className="retry-room-list-button"
            onClick={() => {
              void requestRooms();
            }}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            다시 불러오기
          </button>
        </div>
      ) : rooms.length === 0 ? (
        <div className="joinable-room-state">
          <UserRound aria-hidden="true" size={28} />
          지금은 참가 가능한 방이 없어요.
        </div>
      ) : (
        <>
          {listError ? (
            <p className="joinable-room-notice" role="alert">
              <AlertCircle aria-hidden="true" size={17} />
              목록을 새로 불러오지 못했어요. 이전 목록을 표시하고
              있어요.
            </p>
          ) : null}
          <ul className="joinable-room-list">
            {rooms.map((room) => {
              const joining = joiningRoomCode === room.roomCode;
              const roomError =
                joinError?.roomCode === room.roomCode
                  ? joinError.message
                  : null;
              return (
                <li className="joinable-room-row" key={room.roomCode}>
                  <div className="joinable-room-host">
                    <span className="joinable-room-host-icon">
                      <UserRound aria-hidden="true" size={20} />
                    </span>
                    <span>
                      <strong>{room.hostNickname}님의 방</strong>
                      <em className={`game-mode-badge mode-${(room.mode ?? "TWENTY_QUESTIONS").toLowerCase()}`}>
                        {room.mode === "SILHOUETTE"
                          ? "실루엣 퀴즈"
                          : "스무고개"}
                      </em>
                      <small className="room-code">
                        {room.roomCode}
                      </small>
                    </span>
                  </div>
                  <button
                    aria-label={`${room.hostNickname}님의 방 ${room.roomCode} 입장하기`}
                    className="joinable-room-enter"
                    disabled={disabled || joiningRoomCode !== null}
                    onClick={() => {
                      void handleJoin(room);
                    }}
                    type="button"
                  >
                    {joining ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="spin-icon"
                        size={16}
                      />
                    ) : null}
                    {joining ? "입장 중..." : "입장하기"}
                  </button>
                  {roomError ? (
                    <p className="joinable-room-row-error" role="alert">
                      <AlertCircle aria-hidden="true" size={15} />
                      {roomError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function listedRoomJoinError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "ROOM_FULL") {
      return "다른 사용자가 먼저 입장했어요.";
    }
    if (
      error.code === "ROOM_EXPIRED" ||
      error.code === "ROOM_NOT_FOUND"
    ) {
      return "방이 닫혀 더 이상 입장할 수 없어요.";
    }
    return error.detail;
  }
  return "방에 입장하지 못했습니다. 다시 시도해 주세요.";
}

function isStaleRoomError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    STALE_ROOM_ERROR_CODES.has(error.code)
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

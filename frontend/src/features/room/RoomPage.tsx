import {
  Check,
  CircleHelp,
  Clock3,
  Copy,
  DoorOpen,
  Info,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Radio,
  Search,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Link,
  useBeforeUnload,
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import { useAuth } from "../auth/AuthContext";
import { GameInterruptionDialogs } from "../game/GameInterruptionDialogs";
import { GameResultScreen } from "../game/GameResultScreen";
import { GameScreen } from "../game/GameScreen";
import {
  PokemonArtwork,
  formatNationalDexId,
} from "../pokemon/PokemonArtwork";
import { PokemonCatalogPicker } from "../pokemon/PokemonCatalogPicker";
import { PokemonTypeBadges } from "../pokemon/PokemonTypeBadges";
import {
  type PokemonCatalogGateway,
  pokemonCatalogGateway,
} from "../pokemon/pokemonApi";
import type { PokemonSummary } from "../pokemon/pokemonTypes";
import {
  ApiError,
} from "../../shared/api/HttpClient";
import {
  type RealtimeConnectionStatus,
  type RoomRealtimeGateway,
  type RoomRealtimeSession,
  roomRealtimeGateway,
} from "../../shared/realtime/RoomRealtimeGateway";
import type {
  RoomClosedReason,
  RoomRealtimeEvent,
} from "../../shared/realtime/realtimeTypes";
import { Modal } from "../../shared/ui/Modal";
import { PageStatus } from "../../shared/ui/PageStatus";
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
  applyRoomEvent,
} from "./roomState";
import type {
  ActiveRoomSnapshot,
  RoomMember,
  RoomSnapshot,
  WaitingRoomSnapshot,
} from "./roomTypes";

type ClipboardWriter = (value: string) => Promise<void>;
type PendingCommandKind =
  | "answer"
  | "ask"
  | "guess"
  | "rematch"
  | "select";

interface PendingCommand {
  readonly commandId: string;
  readonly expectedStateVersion: number;
  readonly kind: PendingCommandKind;
}

interface RoomPageProps {
  gateway?: RoomGateway;
  pokemonGateway?: PokemonCatalogGateway;
  realtimeGateway?: RoomRealtimeGateway;
  writeClipboard?: ClipboardWriter;
}

export function RoomPage({
  gateway = roomGateway,
  pokemonGateway = pokemonCatalogGateway,
  realtimeGateway = roomRealtimeGateway,
  writeClipboard = defaultClipboardWriter,
}: RoomPageProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { roomCode: routeRoomCode = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const roomCode = normalizeRoomCode(routeRoomCode);
  const validRoomCode = isValidRoomCode(roomCode);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(
    null,
  );
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
  const [explicitLeaveOpen, setExplicitLeaveOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [roomClosedReason, setRoomClosedReason] =
    useState<RoomClosedReason | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingCommand, setPendingCommandState] =
    useState<PendingCommand | null>(null);
  const pendingCommandRef = useRef<PendingCommand | null>(null);
  const realtimeSessionRef = useRef<RoomRealtimeSession | null>(
    null,
  );
  const allowNavigationRef = useRef(false);
  const previousOpponentRef = useRef<{
    member: RoomMember | null;
    roomCode: string;
  } | null>(null);
  const previousRoomStatusRef = useRef<RoomSnapshot["status"] | null>(
    null,
  );
  const setActiveRoomCode = auth.setActiveRoomCode;
  const activeSnapshot = isActiveSnapshot(snapshot)
    ? snapshot
    : null;
  const questionerPokedexContext =
    getQuestionerPokedexContext(
      snapshot,
      pendingCommand !== null,
    );
  const questionerPokedexAllowed =
    questionerPokedexContext !== null;
  const pokedexModalOpen =
    searchParams.get("pokedex") === "1" &&
    questionerPokedexAllowed;

  const setPendingCommand = useCallback(
    (command: PendingCommand | null) => {
      pendingCommandRef.current = command;
      setPendingCommandState(command);
    },
    [],
  );

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowNavigationRef.current &&
      hasRoomMembership(snapshot) &&
      roomClosedReason === null &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useBeforeUnload(
    useCallback(
      (event) => {
        if (activeSnapshot && !allowNavigationRef.current) {
          event.preventDefault();
        }
      },
      [activeSnapshot],
    ),
  );

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
    const currentStatus = snapshot?.status ?? null;
    if (
      currentStatus === "RESULT" &&
      previousRoomStatusRef.current !== null &&
      previousRoomStatusRef.current !== "RESULT"
    ) {
      window.scrollTo(0, 0);
    }
    previousRoomStatusRef.current = currentStatus;
  }, [snapshot?.status]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    const legacyGuessOpen = searchParams.get("guess") === "1";
    const invalidPokedexOpen =
      searchParams.get("pokedex") === "1" &&
      !questionerPokedexAllowed;
    if (!legacyGuessOpen && !invalidPokedexOpen) {
      return;
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("guess");
        if (invalidPokedexOpen) {
          next.delete("pokedex");
        }
        return next;
      },
      { replace: true },
    );
  }, [
    questionerPokedexAllowed,
    searchParams,
    setSearchParams,
    snapshot,
  ]);

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

    const handleEvent = (event: RoomRealtimeEvent) => {
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
        allowNavigationRef.current = true;
        setActiveRoomCode(null);
        setRoomClosedReason(event.payload.reason);
        setPendingCommand(null);
        return;
      }
      if (
        event.eventType === "GAME_ENDED" &&
        event.payload.endReason === "PLAYER_LEFT"
      ) {
        setActiveRoomCode(null);
      }
      if (completesPendingCommand(pendingCommandRef.current, event)) {
        setPendingCommand(null);
      }
      setSnapshot((current) => applyRoomEvent(current, event));
    };

    try {
      realtimeSession = realtimeGateway.open(roomCode, {
        onEvent: handleEvent,
        onRealtimeError: (error) => {
          if (!active) {
            return;
          }
          if (
            error.commandId === null ||
            error.commandId ===
              pendingCommandRef.current?.commandId
          ) {
            setPendingCommand(null);
          }
          setRealtimeError(error.message);
          if (error.recoverable) {
            try {
              realtimeSessionRef.current?.requestSnapshot();
            } catch {
              // 재연결 시 자동 resume가 최신 snapshot을 요청한다.
            }
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
      realtimeSessionRef.current = realtimeSession;
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
      if (realtimeSessionRef.current === realtimeSession) {
        realtimeSessionRef.current = null;
      }
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
    setPendingCommand,
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
      allowNavigationRef.current = true;
      setActiveRoomCode(null);
      setExplicitLeaveOpen(false);
      setLogoutOpen(false);
      if (blocker.state === "blocked") {
        blocker.proceed();
      } else {
        navigate("/lobby", { replace: true });
      }
    } catch (error) {
      setLeaveError(toSafeDetail(error));
      setLeaving(false);
    }
  };

  const sendCommand = (
    kind: PendingCommandKind,
    expectedStateVersion: number,
    publish: (session: RoomRealtimeSession) => string,
  ): boolean => {
    if (pendingCommandRef.current) {
      return false;
    }
    setRealtimeError(null);
    try {
      const session = realtimeSessionRef.current;
      if (!session) {
        throw realtimeUnavailableError();
      }
      const commandId = publish(session);
      setPendingCommand({
        commandId,
        expectedStateVersion,
        kind,
      });
      return true;
    } catch (error) {
      setRealtimeError(toSafeDetail(error));
      return false;
    }
  };

  const openPokedex = () => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("guess");
        next.set("pokedex", "1");
        return next;
      },
      { replace: false },
    );
  };

  const closePokedex = () => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("pokedex");
        return next;
      },
      { replace: true },
    );
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

  return (
    <main className="site-page room-page">
      <div className="site-frame room-frame">
        <RoomHeader
          active={isActiveSnapshot(snapshot)}
          connectionStatus={connectionStatus}
          onCopy={() => {
            void copyRoomCode();
          }}
          onLeave={() => {
            setExplicitLeaveOpen(true);
          }}
          onLogout={() => {
            setLogoutOpen(true);
          }}
          roomCode={roomCode}
          snapshot={snapshot}
        />

        <p aria-live="polite" className="room-live-region">
          {announcement}
        </p>
        {realtimeError || leaveError ? (
          <div className="room-inline-alert" role="alert">
            <WifiOff aria-hidden="true" size={18} />
            <span>{leaveError ?? realtimeError}</span>
          </div>
        ) : null}

        {snapshot.status === "WAITING_FOR_OPPONENT" ? (
          <WaitingForOpponentView
            copyFeedback={copyFeedback}
            leaving={leaving}
            onCopy={() => {
              void copyRoomCode();
            }}
            onLeave={() => {
              void leaveRoom();
            }}
            roomCode={roomCode}
            snapshot={snapshot}
          />
        ) : null}

        {snapshot.status === "WAITING_FOR_SELECTION" ? (
          snapshot.me.role === "SELECTOR" ? (
            <SelectorSelectionView
              commandPending={pendingCommand !== null}
              connected={
                connectionStatus === "connected" &&
                snapshot.opponent.connected
              }
              gateway={pokemonGateway}
              onConfirm={(pokemon) => {
                sendCommand(
                  "select",
                  snapshot.stateVersion,
                  (session) =>
                    session.selectPokemon(
                      pokemon.nationalDexId,
                      snapshot.stateVersion,
                    ),
                );
              }}
            />
          ) : (
            <QuestionerSelectionWaitView
              onOpenPokedex={openPokedex}
              snapshot={snapshot}
            />
          )
        ) : null}

        {isActiveSnapshot(snapshot) ? (
          <>
            <GameScreen
              commandPending={pendingCommand !== null}
              onAnswer={(answer) => {
                sendCommand(
                  "answer",
                  snapshot.stateVersion,
                  (session) =>
                    session.answerQuestion(
                      answer,
                      snapshot.stateVersion,
                    ),
                );
              }}
              onAsk={(question) => {
                sendCommand(
                  "ask",
                  snapshot.stateVersion,
                  (session) =>
                    session.askQuestion(
                      question,
                      snapshot.stateVersion,
                    ),
                );
              }}
              onOpenPokedex={openPokedex}
              snapshot={snapshot}
            />
            <GameInterruptionDialogs
              leaveOpen={
                explicitLeaveOpen || blocker.state === "blocked"
              }
              leaving={leaving}
              logoutOpen={logoutOpen}
              onCancelLeave={() => {
                setExplicitLeaveOpen(false);
                if (blocker.state === "blocked") {
                  blocker.reset();
                }
              }}
              onCancelLogout={() => {
                setLogoutOpen(false);
              }}
              onConfirmLeave={() => {
                void leaveRoom();
              }}
              snapshot={snapshot}
            />
          </>
        ) : null}

        {snapshot.status === "RESULT" ? (
          <GameResultScreen
            commandPending={pendingCommand !== null}
            onLeave={() => {
              if (snapshot.game.endReason === "PLAYER_LEFT") {
                allowNavigationRef.current = true;
                setActiveRoomCode(null);
                navigate("/lobby", { replace: true });
              } else {
                void leaveRoom();
              }
            }}
            onRematch={(ready) => {
              sendCommand(
                "rematch",
                snapshot.stateVersion,
                (session) =>
                  session.changeRematchReady(
                    ready,
                    snapshot.stateVersion,
                  ),
              );
            }}
            snapshot={snapshot}
          />
        ) : null}

        {blocker.state === "blocked" &&
        !isActiveSnapshot(snapshot) ? (
          <Modal
            className="interruption-modal"
            onClose={() => {
              blocker.reset();
            }}
            title="방에서 나갈까요?"
          >
            <DoorOpen
              aria-hidden="true"
              className="interruption-icon danger-icon"
              size={42}
            />
            <p>
              {snapshot.status === "RESULT"
                ? "결과 화면에서 나가면 이 방은 종료돼요."
                : "방을 나간 뒤에는 같은 방 코드로 돌아올 수 없어요."}
            </p>
            <div className="modal-actions">
              <button
                className="secondary-game-button"
                onClick={() => {
                  blocker.reset();
                }}
                type="button"
              >
                계속하기
              </button>
              <button
                className="danger-game-button"
                disabled={leaving}
                onClick={() => {
                  void leaveRoom();
                }}
                type="button"
              >
                방 나가기
              </button>
            </div>
          </Modal>
        ) : null}

        {pokedexModalOpen && questionerPokedexContext ? (
          <QuestionerPokedexModal
            context={questionerPokedexContext}
            gateway={pokemonGateway}
            onClose={closePokedex}
            onGuess={(pokemon) => {
              if (
                !questionerPokedexContext.canGuess ||
                questionerPokedexContext.stateVersion === null
              ) {
                return;
              }
              const expectedStateVersion =
                questionerPokedexContext.stateVersion;
              const published = sendCommand(
                "guess",
                expectedStateVersion,
                (session) =>
                  session.guessPokemon(
                    pokemon.nationalDexId,
                    expectedStateVersion,
                  ),
              );
              if (published) {
                closePokedex();
              }
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

interface RoomHeaderProps {
  active: boolean;
  connectionStatus: RealtimeConnectionStatus;
  onCopy(): void;
  onLeave(): void;
  onLogout(): void;
  roomCode: string;
  snapshot: RoomSnapshot;
}

function RoomHeader({
  active,
  connectionStatus,
  onCopy,
  onLeave,
  onLogout,
  roomCode,
  snapshot,
}: RoomHeaderProps) {
  return (
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
          onClick={onCopy}
          type="button"
        >
          <Copy aria-hidden="true" size={17} />
        </button>
      </div>
      {snapshot.opponent ? (
        <div className="room-role-badges">
          <span className="questioner-badge">
            <UserRound aria-hidden="true" size={16} />
            질문자
          </span>
          <span className="selector-badge">
            <UserRound aria-hidden="true" size={16} />
            출제자
          </span>
        </div>
      ) : null}
      <ConnectionBadge status={connectionStatus} />
      {active ? (
        <div className="room-header-actions">
          <button onClick={onLeave} type="button">
            <DoorOpen aria-hidden="true" size={17} />
            게임 나가기
          </button>
          <button onClick={onLogout} type="button">
            <LogOut aria-hidden="true" size={17} />
            로그아웃
          </button>
        </div>
      ) : null}
    </header>
  );
}

interface WaitingForOpponentViewProps {
  copyFeedback: string;
  leaving: boolean;
  onCopy(): void;
  onLeave(): void;
  roomCode: string;
  snapshot: WaitingRoomSnapshot;
}

function WaitingForOpponentView({
  copyFeedback,
  leaving,
  onCopy,
  onLeave,
  roomCode,
  snapshot,
}: WaitingForOpponentViewProps) {
  return (
    <section className="room-content" aria-labelledby="room-title">
      <div className="room-status-heading">
        <span className="room-status-icon" aria-hidden="true">
          <Clock3 size={25} />
        </span>
        <div>
          <p className="section-kicker">
            ROUND {snapshot.roundNumber}
          </p>
          <h1 id="room-title">상대를 기다리는 중</h1>
          <p>
            친구가 입장하면 정답 포켓몬 선택 단계로 이동해요.
          </p>
        </div>
      </div>

      <div className="participant-grid">
        <ParticipantCard
          index="1"
          isMe
          member={snapshot.me}
          role="출제자"
          tone="mint"
        />
        <ParticipantCard
          index="2"
          isMe={false}
          member={null}
          role="질문자"
          tone="blue"
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
            onClick={onCopy}
            type="button"
          >
            <Copy aria-hidden="true" size={18} />
          </button>
        </div>
      </div>
      <p aria-live="polite" className="room-copy-feedback">
        {copyFeedback ? (
          <>
            <Check aria-hidden="true" size={16} />
            {copyFeedback}
          </>
        ) : null}
      </p>
      <div className="room-expiry-note">
        <Info aria-hidden="true" size={18} />
        30분 동안 상대가 입장하지 않으면 방이 닫혀요.
      </div>
      <button
        className="room-leave-button"
        disabled={leaving}
        onClick={onLeave}
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
  );
}

interface SelectorSelectionViewProps {
  commandPending: boolean;
  connected: boolean;
  gateway: PokemonCatalogGateway;
  onConfirm(pokemon: PokemonSummary): void;
}

function SelectorSelectionView({
  commandPending,
  connected,
  gateway,
  onConfirm,
}: SelectorSelectionViewProps) {
  const [selectedPokemon, setSelectedPokemon] =
    useState<PokemonSummary | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="selection-view">
      <header>
        <h1>정답 포켓몬 선택</h1>
        <p>
          <LockKeyhole aria-hidden="true" size={16} />
          선택한 포켓몬은 상대에게 보이지 않아요.
        </p>
      </header>
      <div className="selection-layout">
        <PokemonCatalogPicker
          gateway={gateway}
          onSelect={setSelectedPokemon}
          selectedPokemon={selectedPokemon}
        />
        <aside className="selection-preview panel-card">
          <h2>선택한 포켓몬</h2>
          {selectedPokemon ? (
            <>
              <PokemonArtwork pokemon={selectedPokemon} />
              <span>
                {formatNationalDexId(
                  selectedPokemon.nationalDexId,
                )}
              </span>
              <strong>{selectedPokemon.koreanName}</strong>
              <PokemonTypeBadges types={selectedPokemon.types} />
            </>
          ) : (
            <p>도감에서 정답으로 사용할 포켓몬을 골라 주세요.</p>
          )}
          <div>
            <LockKeyhole aria-hidden="true" size={17} />
            상대에게는 포켓몬 정보가 공개되지 않아요.
          </div>
          <button
            className="selection-confirm-button"
            disabled={
              !selectedPokemon || !connected || commandPending
            }
            onClick={() => {
              setConfirming(true);
            }}
            type="button"
          >
            <Check aria-hidden="true" size={19} />이 포켓몬 선택
          </button>
        </aside>
      </div>
      {!connected ? (
        <div className="selection-connection-notice" role="status">
          상대와 실시간 연결을 확인한 뒤 선택할 수 있어요.
        </div>
      ) : null}
      {confirming && selectedPokemon ? (
        <Modal
          className="pokemon-confirm-modal"
          onClose={() => {
            setConfirming(false);
          }}
          title={`${selectedPokemon.koreanName}를 정답으로 선택할까요?`}
        >
          <PokemonArtwork pokemon={selectedPokemon} />
          <strong>
            {formatNationalDexId(
              selectedPokemon.nationalDexId,
            )}{" "}
            {selectedPokemon.koreanName}
          </strong>
          <PokemonTypeBadges types={selectedPokemon.types} />
          <div className="modal-actions">
            <button
              className="secondary-game-button"
              onClick={() => {
                setConfirming(false);
              }}
              type="button"
            >
              취소
            </button>
            <button
              className="selection-confirm-button"
              disabled={commandPending}
              onClick={() => {
                onConfirm(selectedPokemon);
              }}
              type="button"
            >
              선택하기
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function QuestionerSelectionWaitView({
  onOpenPokedex,
  snapshot,
}: {
  onOpenPokedex(): void;
  snapshot: Extract<
    WaitingRoomSnapshot,
    { status: "WAITING_FOR_SELECTION" }
  >;
}) {
  return (
    <section className="selection-wait-view">
      <p className="role-pill blue-pill">질문자</p>
      <LoaderCircle
        aria-hidden="true"
        className="spin-icon"
        size={42}
      />
      <h1>출제자가 포켓몬을 고르고 있어요</h1>
      <p>선택이 완료되면 자동으로 게임을 시작합니다.</p>
      <div>
        <Wifi aria-hidden="true" size={17} />
        {snapshot.opponent.connected
          ? "상대가 연결되어 있습니다."
          : "상대의 재연결을 기다리고 있습니다."}
      </div>
      <button
        className="secondary-game-button selection-wait-pokedex-button"
        onClick={onOpenPokedex}
        type="button"
      >
        <Search aria-hidden="true" size={19} />
        전국도감 보기
      </button>
    </section>
  );
}

interface QuestionerPokedexContext {
  canGuess: boolean;
  detail: string;
  stateVersion: number | null;
}

interface QuestionerPokedexModalProps {
  context: QuestionerPokedexContext;
  gateway: PokemonCatalogGateway;
  onClose(): void;
  onGuess(pokemon: PokemonSummary): void;
}

function QuestionerPokedexModal({
  context,
  gateway,
  onClose,
  onGuess,
}: QuestionerPokedexModalProps) {
  const [selectedPokemon, setSelectedPokemon] =
    useState<PokemonSummary | null>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <Modal
      className="questioner-pokedex-modal"
      closeLabel="전국도감 닫기"
      onClose={onClose}
      title="전국도감"
    >
      <div className="pokedex-guidance" role="status">
        <p>
          <Info aria-hidden="true" size={18} />
          도감을 둘러보거나 포켓몬을 고르는 동안에는 기회를
          사용하지 않아요.
        </p>
        <p>{context.detail}</p>
      </div>
      <PokemonCatalogPicker
        gateway={gateway}
        onSelect={setSelectedPokemon}
        selectedPokemon={selectedPokemon}
      />
      <footer>
        <div>
          <span>선택한 포켓몬</span>
          <strong>
            {selectedPokemon
              ? `${formatNationalDexId(
                  selectedPokemon.nationalDexId,
                )} ${selectedPokemon.koreanName}`
              : "아직 선택하지 않았어요"}
          </strong>
          {selectedPokemon ? (
            <PokemonTypeBadges types={selectedPokemon.types} />
          ) : null}
        </div>
        <button
          className="secondary-game-button"
          onClick={onClose}
          type="button"
        >
          닫기
        </button>
        <button
          className="primary-game-button"
          disabled={!selectedPokemon || !context.canGuess}
          onClick={() => {
            setConfirming(true);
          }}
          type="button"
        >
          이 포켓몬 추측
        </button>
      </footer>
      {confirming && selectedPokemon && context.canGuess ? (
        <Modal
          className="pokemon-confirm-modal"
          onClose={() => {
            setConfirming(false);
          }}
          title={`${selectedPokemon.koreanName}로 추측할까요?`}
        >
          <CircleHelp
            aria-hidden="true"
            className="warning-icon"
            size={40}
          />
          <PokemonTypeBadges types={selectedPokemon.types} />
          <p>틀리면 남은 기회가 줄어들어요.</p>
          <div className="modal-actions">
            <button
              className="secondary-game-button"
              onClick={() => {
                setConfirming(false);
              }}
              type="button"
            >
              돌아가기
            </button>
            <button
              className="primary-game-button"
              disabled={!context.canGuess}
              onClick={() => {
                onGuess(selectedPokemon);
              }}
              type="button"
            >
              추측하기
            </button>
          </div>
        </Modal>
      ) : null}
    </Modal>
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

function isActiveSnapshot(
  snapshot: RoomSnapshot | null,
): snapshot is ActiveRoomSnapshot {
  return (
    snapshot?.status === "PLAYING" ||
    snapshot?.status === "PAUSED"
  );
}

function getQuestionerPokedexContext(
  snapshot: RoomSnapshot | null,
  commandPending: boolean,
): QuestionerPokedexContext | null {
  if (!snapshot || snapshot.me.role !== "QUESTIONER") {
    return null;
  }
  if (snapshot.status === "WAITING_FOR_SELECTION") {
    return {
      canGuess: false,
      detail: "게임이 시작되면 포켓몬을 추측할 수 있어요.",
      stateVersion: null,
    };
  }
  if (
    snapshot.status !== "PLAYING" ||
    "selectedPokemon" in snapshot.game
  ) {
    return null;
  }

  const lastAction = snapshot.game.actions.at(-1);
  if (commandPending) {
    return {
      canGuess: false,
      detail:
        "이전 요청을 처리하는 동안에는 도감만 볼 수 있어요.",
      stateVersion: snapshot.stateVersion,
    };
  }
  if (
    lastAction?.type === "QUESTION" &&
    lastAction.answer === null
  ) {
    return {
      canGuess: false,
      detail:
        "출제자의 답변을 기다리는 동안에는 도감만 볼 수 있어요.",
      stateVersion: snapshot.stateVersion,
    };
  }
  if (snapshot.game.remainingActionCount === 0) {
    return {
      canGuess: false,
      detail: "남은 기회를 모두 사용해 지금은 추측할 수 없어요.",
      stateVersion: snapshot.stateVersion,
    };
  }
  return {
    canGuess: true,
    detail:
      "최종 추측을 보내면 기회 1회를 사용해요. " +
      `현재 ${snapshot.game.remainingActionCount}회 남았어요.`,
    stateVersion: snapshot.stateVersion,
  };
}

function hasRoomMembership(
  snapshot: RoomSnapshot | null,
): boolean {
  return !(
    snapshot === null ||
    (snapshot.status === "RESULT" &&
      snapshot.game.endReason === "PLAYER_LEFT")
  );
}

function completesPendingCommand(
  pending: PendingCommand | null,
  event: RoomRealtimeEvent,
): boolean {
  if (
    !pending ||
    event.stateVersion < pending.expectedStateVersion
  ) {
    return false;
  }
  if (event.eventType === "ROOM_SNAPSHOT") {
    return event.stateVersion > pending.expectedStateVersion;
  }
  return (
    (pending.kind === "select" &&
      event.eventType === "ROUND_STARTED") ||
    (pending.kind === "ask" &&
      event.eventType === "QUESTION_ASKED") ||
    (pending.kind === "answer" &&
      (event.eventType === "QUESTION_ANSWERED" ||
        event.eventType === "GAME_ENDED")) ||
    (pending.kind === "guess" &&
      (event.eventType === "GUESS_RESOLVED" ||
        event.eventType === "GAME_ENDED")) ||
    (pending.kind === "rematch" &&
      event.eventType === "REMATCH_STATE_CHANGED")
  );
}

function toSafeDetail(error: unknown): string {
  return error instanceof ApiError
    ? error.detail
    : "요청을 처리하지 못했습니다. 다시 시도해 주세요.";
}

function realtimeUnavailableError(): ApiError {
  return new ApiError({
    code: "REALTIME_NOT_CONNECTED",
    detail:
      "실시간 연결을 확인하고 있어요. 연결된 뒤 다시 시도해 주세요.",
    status: 0,
    title: "실시간 연결 확인",
  });
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

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";

import {
  AuthContext,
  type AuthContextValue,
} from "../auth/AuthContext";
import { ApiError } from "../../shared/api/HttpClient";
import type {
  RealtimeConnectionStatus,
  RoomRealtimeGateway,
  RoomRealtimeHandlers,
  RoomRealtimeSession,
} from "../../shared/realtime/RoomRealtimeGateway";
import type { WaitingRoomEvent } from "../../shared/realtime/realtimeTypes";
import type { PokemonGateway } from "../pokemon/pokemonApi";
import {
  createAuthContextValue,
  TEST_CURRENT_USER,
} from "../../test/authTestUtils";
import type { RoomGateway } from "./roomApi";
import { RoomPage } from "./RoomPage";
import type {
  QuestionerActiveRoomSnapshot,
  ResultRoomSnapshot,
  SelectorActiveRoomSnapshot,
  WaitingRoomSnapshot,
} from "./roomTypes";

describe("RoomPage", () => {
  it("should_loadSnapshotAndOpenRealtime_when_directRoomRouteOpens", async () => {
    const setActiveRoomCode = vi.fn();
    const gateway = createRoomGateway();
    const realtime = createRealtimeHarness();

    renderRoom({
      auth: createAuthContextValue({
        currentUser: TEST_CURRENT_USER,
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway,
      realtimeGateway: realtime.gateway,
    });

    expect(
      await screen.findByRole("heading", {
        name: "상대를 기다리는 중",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("레드")).toBeInTheDocument();
    expect(gateway.get).toHaveBeenCalledWith(
      "AB3K7M",
      expect.any(AbortSignal),
    );
    expect(realtime.gateway.open).toHaveBeenCalledWith(
      "AB3K7M",
      expect.any(Object),
    );
    expect(setActiveRoomCode).toHaveBeenCalledWith("AB3K7M");
  });

  it("should_applySameVersionSnapshot_when_playerJoinedNoticeArrivesFirst", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway(),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "상대를 기다리는 중",
    });

    act(() => {
      realtime.event({
        ...baseEvent(2),
        eventType: "PLAYER_JOINED",
        payload: {
          player: {
            nickname: "그린",
            userId: GUEST_MEMBER.userId,
          },
        },
      });
      realtime.event({
        ...baseEvent(2),
        eventType: "ROOM_SNAPSHOT",
        payload: TWO_PLAYER_SNAPSHOT,
      });
    });

    expect(
      await screen.findByRole("heading", {
        name: "역할 선택 중",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("그린님이 방에 입장했어요."),
    ).toBeInTheDocument();
    expect(screen.queryByText("피카츄")).not.toBeInTheDocument();
  });

  it("should_submitAndChangeRolePreference_when_firstRoundIsWaiting", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "역할 선택 중",
    });
    act(() => {
      realtime.status("connected");
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /포켓몬을 정하고 답하기/,
      }),
    );
    expect(realtime.changeRolePreference).toHaveBeenCalledWith(
      "SELECTOR",
      2,
    );

    act(() => {
      realtime.event({
        ...baseEvent(3),
        eventType: "ROOM_SNAPSHOT",
        payload: {
          ...TWO_PLAYER_SNAPSHOT,
          roleSelection: {
            opponentSelected: false,
            preferredRole: "SELECTOR",
          },
          stateVersion: 3,
        },
      });
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /질문하고 맞히기/,
      }),
    );
    expect(
      realtime.changeRolePreference,
    ).toHaveBeenLastCalledWith("QUESTIONER", 3);
  });

  it("should_showDisconnectedOpponent_when_connectionEventArrives", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "역할 선택 중",
    });

    act(() => {
      realtime.event({
        ...baseEvent(3),
        eventType: "PLAYER_CONNECTION_CHANGED",
        payload: {
          connected: false,
          reconnectDeadline: null,
          userId: GUEST_MEMBER.userId,
        },
      });
    });

    expect(
      await screen.findByText(
        "두 참가자의 실시간 연결을 확인한 뒤 선택할 수 있어요.",
      ),
    ).toBeInTheDocument();
  });

  it("should_announceDeparture_when_guestLeavesWaitingRoom", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "역할 선택 중",
    });

    act(() => {
      realtime.event({
        ...baseEvent(3),
        eventType: "ROOM_SNAPSHOT",
        payload: {
          ...HOST_SNAPSHOT,
          stateVersion: 3,
        },
      });
    });

    expect(
      await screen.findByText("그린님이 방을 나갔어요."),
    ).toBeInTheDocument();
  });

  it("should_clearActiveRoomAndShowClosedState_when_hostLeaves", async () => {
    const setActiveRoomCode = vi.fn();
    const realtime = createRealtimeHarness();
    renderRoom({
      auth: createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "역할 선택 중",
    });

    act(() => {
      realtime.event({
        ...baseEvent(2),
        eventType: "ROOM_CLOSED",
        payload: {
          leftUserId: HOST_MEMBER.userId,
          reason: "HOST_LEFT",
        },
      });
    });

    expect(
      await screen.findByRole("heading", {
        name: "방이 종료됐어요",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("방장이 방을 나가 대기방을 종료했어요."),
    ).toBeInTheDocument();
    expect(setActiveRoomCode).toHaveBeenCalledWith(null);
  });

  it("should_ignoreLateSnapshot_when_roomClosedEventArrivesFirst", async () => {
    let resolveSnapshot:
      | ((snapshot: WaitingRoomSnapshot) => void)
      | undefined;
    const get = vi.fn().mockReturnValue(
      new Promise<WaitingRoomSnapshot>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const setActiveRoomCode = vi.fn();
    const realtime = createRealtimeHarness();
    renderRoom({
      auth: createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway: createRoomGateway({ get }),
      realtimeGateway: realtime.gateway,
    });

    act(() => {
      realtime.event({
        ...baseEvent(2),
        eventType: "ROOM_CLOSED",
        payload: {
          leftUserId: HOST_MEMBER.userId,
          reason: "HOST_LEFT",
        },
      });
    });
    expect(
      await screen.findByRole("heading", {
        name: "방이 종료됐어요",
      }),
    ).toBeInTheDocument();

    await act(async () => {
      resolveSnapshot?.(TWO_PLAYER_SNAPSHOT);
      await Promise.resolve();
    });

    expect(setActiveRoomCode).toHaveBeenCalledWith(null);
    expect(setActiveRoomCode).not.toHaveBeenCalledWith("AB3K7M");
  });

  it("should_copyRoomCodeAndAnnounceSuccess_when_copyIsAllowed", async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    renderRoom({
      writeClipboard,
    });
    await screen.findByRole("heading", {
      name: "상대를 기다리는 중",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "방 코드 복사" }),
    );

    expect(await screen.findByText("방 코드를 복사했어요.")).toBeInTheDocument();
    expect(writeClipboard).toHaveBeenCalledWith("AB3K7M");
  });

  it("should_clearActiveRoomAndOpenLobby_when_leaveSucceeds", async () => {
    const setActiveRoomCode = vi.fn();
    const gateway = createRoomGateway();
    const { router } = renderRoom({
      auth: createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway,
    });
    await screen.findByRole("heading", {
      name: "상대를 기다리는 중",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "방 나가기" }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/lobby");
    });
    expect(gateway.leave).toHaveBeenCalledWith("AB3K7M");
    expect(setActiveRoomCode).toHaveBeenCalledWith(null);
  });

  it("should_showSafeErrorAndRetry_when_snapshotRequestFails", async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({
          code: "ROOM_NOT_FOUND",
          detail: "방을 찾을 수 없습니다.",
          status: 404,
          title: "방 없음",
        }),
      )
      .mockResolvedValueOnce(HOST_SNAPSHOT);
    renderRoom({
      gateway: createRoomGateway({ get }),
    });

    expect(
      await screen.findByRole("heading", {
        name: "대기방을 불러오지 못했어요",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("방을 찾을 수 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(
      await screen.findByRole("heading", {
        name: "상대를 기다리는 중",
      }),
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("should_skipRoomRequests_when_routeCodeIsInvalid", async () => {
    const gateway = createRoomGateway();
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway,
      initialEntry: "/rooms/ABC101",
      realtimeGateway: realtime.gateway,
    });

    expect(
      await screen.findByRole("heading", {
        name: "방 코드를 확인해 주세요",
      }),
    ).toBeInTheDocument();
    expect(gateway.get).not.toHaveBeenCalled();
    expect(realtime.gateway.open).not.toHaveBeenCalled();
  });

  it("should_closeRealtimeSession_when_roomPageUnmounts", async () => {
    const realtime = createRealtimeHarness();
    const { unmount } = renderRoom({
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "상대를 기다리는 중",
    });

    unmount();

    expect(realtime.close).toHaveBeenCalledOnce();
  });

  it("should_selectPokemonOnce_when_selectorConfirmsChoice", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(
            ASSIGNED_SELECTOR_SELECTION_SNAPSHOT,
          ),
      }),
      pokemonGateway: createPokemonGateway([PIKACHU]),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "정답 포켓몬 선택",
    });
    act(() => {
      realtime.status("connected");
    });

    fireEvent.click(
      await screen.findByRole("button", { name: /피카츄/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "이 포켓몬 선택" }),
    );
    expect(screen.getAllByText("전기").length).toBeGreaterThan(1);
    expect(
      within(
        screen.getByRole("dialog", {
          name: "피카츄를 정답으로 선택할까요?",
        }),
      ).getByText("전기"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "선택하기" }),
    );

    expect(realtime.selectPokemon).toHaveBeenCalledWith(25, 4);
  });

  it("should_allowPokedexBrowsingWithoutGuess_when_questionerWaitsForSelection", async () => {
    const realtime = createRealtimeHarness();
    const { router } = renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_SELECTION_SNAPSHOT),
      }),
      pokemonGateway: createPokemonGateway([PIKACHU]),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", {
      name: "출제자가 포켓몬을 고르고 있어요",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );

    expect(router.state.location.search).toBe("?pokedex=1");
    const pokedex = screen.getByRole("dialog", {
      name: "전국도감",
    });
    expect(pokedex).toBeInTheDocument();
    expect(pokedex).not.toHaveAttribute("aria-modal");
    expect(pokedex.closest(".modal-backdrop")).toBeNull();
    expect(
      screen.getByText("게임이 시작되면 포켓몬을 추측할 수 있어요."),
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: /피카츄/ }),
    );
    expect(screen.getAllByText("전기").length).toBeGreaterThan(1);
    expect(
      screen.getByRole("button", { name: "이 포켓몬 추측" }),
    ).toBeDisabled();
    expect(realtime.guessPokemon).not.toHaveBeenCalled();
  });

  it("should_keepAnswerSecretOutOfDom_when_questionerGameLoads", async () => {
    const pokemonGateway = createPokemonGateway([PIKACHU]);
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
      pokemonGateway,
    });

    expect(
      await screen.findByText("내 역할 · 질문자"),
    ).toBeInTheDocument();
    expect(screen.queryByText("피카츄")).not.toBeInTheDocument();
    expect(screen.queryByText("전기")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(
      PIKACHU.artworkUrl,
    );
    expect(
      pokemonGateway.findEvolutionDetails,
    ).not.toHaveBeenCalled();
  });

  it("should_allowBrowseOnlyPokedex_when_selectorOpensPokedex", async () => {
    const realtime = createRealtimeHarness();
    const { router } = renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(SELECTOR_ACTIVE_SNAPSHOT),
      }),
      pokemonGateway: createPokemonGateway([PIKACHU]),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내가 선택한 포켓몬");

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );

    expect(router.state.location.search).toBe("?pokedex=1");
    const pokedex = screen.getByRole("dialog", {
      name: "전국도감",
    });
    fireEvent.click(
      await within(pokedex).findByRole("button", {
        name: /피카츄/,
      }),
    );
    expect(
      within(pokedex).getByText(
        "도감에서 포켓몬을 살펴봐도 정답은 바뀌지 않아요.",
      ),
    ).toBeInTheDocument();
    expect(
      within(pokedex).queryByRole("button", {
        name: "이 포켓몬 추측",
      }),
    ).not.toBeInTheDocument();
    expect(realtime.guessPokemon).not.toHaveBeenCalled();

    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.search).toBe("");
  });

  it("should_removePokedexRouteState_when_selectorGameIsPaused", async () => {
    const { router } = renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue({
          ...SELECTOR_ACTIVE_SNAPSHOT,
          status: "PAUSED",
        }),
      }),
      initialEntry: "/rooms/AB3K7M?pokedex=1",
    });
    await screen.findByText("내가 선택한 포켓몬");

    await waitFor(() => {
      expect(router.state.location.search).toBe("");
    });
    expect(
      screen.queryByRole("dialog", { name: "전국도감" }),
    ).not.toBeInTheDocument();
  });

  it("should_sendAnswerComment_when_selectorAnswersQuestion", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(SELECTOR_PENDING_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    const comment = await screen.findByLabelText(
      "답변 코멘트 (선택)",
    );
    fireEvent.change(comment, {
      target: { value: "  날개처럼 보이지만 팔이에요.  " },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "아니요" }),
    );

    expect(realtime.answerQuestion).toHaveBeenCalledWith(
      "NO",
      "  날개처럼 보이지만 팔이에요.  ",
      4,
    );
    expect(comment).toHaveValue("");
    expect(comment).toBeDisabled();
  });

  it("should_allowPokedexBrowsingWithoutGuess_when_questionIsWaitingForAnswer", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_PENDING_SNAPSHOT),
      }),
      pokemonGateway: createPokemonGateway([PIKACHU]),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /피카츄/ }),
    );

    expect(
      screen.getByText(
        "출제자의 답변을 기다리는 동안에는 도감만 볼 수 있어요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "이 포켓몬 추측" }),
    ).toBeDisabled();
    expect(realtime.guessPokemon).not.toHaveBeenCalled();
  });

  it("should_allowPokedexBrowsingWithoutGuess_when_questionCommandIsPending", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
      pokemonGateway: createPokemonGateway([PIKACHU]),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");
    fireEvent.change(screen.getByLabelText("질문"), {
      target: { value: "날개가 있나요?" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "질문하기" }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /피카츄/ }),
    );

    expect(
      screen.getByText(
        "이전 요청을 처리하는 동안에는 도감만 볼 수 있어요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "이 포켓몬 추측" }),
    ).toBeDisabled();
    expect(realtime.guessPokemon).not.toHaveBeenCalled();
  });

  it("should_disableGuessButAllowPokedex_when_noActionsRemain", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_NO_ACTION_SNAPSHOT),
      }),
      pokemonGateway: createPokemonGateway([PIKACHU]),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /피카츄/ }),
    );

    expect(
      screen.getByText(
        "남은 기회를 모두 사용해 지금은 추측할 수 없어요.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "이 포켓몬 추측" }),
    ).toBeDisabled();
    expect(realtime.guessPokemon).not.toHaveBeenCalled();
  });

  it("should_publishQuestionAndOpenPokedexInRouteState_when_questionerActs", async () => {
    const realtime = createRealtimeHarness();
    const { router } = renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");
    act(() => {
      realtime.status("connected");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );
    expect(router.state.location.search).toBe("?pokedex=1");
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.search).toBe("");

    fireEvent.change(screen.getByLabelText("질문"), {
      target: { value: "날개가 있나요?" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "질문하기" }),
    );

    expect(realtime.askQuestion).toHaveBeenCalledWith(
      "날개가 있나요?",
      3,
    );

    act(() => {
      realtime.event({
        ...baseEvent(4),
        eventType: "QUESTION_ASKED",
        gameId: GAME_ID,
        payload: {
          question: "날개가 있나요?",
          remainingActionCount: 19,
          sequenceNo: 1,
          usedActionCount: 1,
        },
      });
    });
  });

  it("should_closePokedexRouteState_when_escapePressed", async () => {
    const { router } = renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
    });
    await screen.findByText("내 역할 · 질문자");
    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(router.state.location.search).toBe("");
    });
    expect(
      screen.queryByRole("dialog", { name: "전국도감" }),
    ).not.toBeInTheDocument();
  });

  it("should_closePokedexRouteState_when_guessPublishes", async () => {
    const realtime = createRealtimeHarness();
    const { router } = renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
      pokemonGateway: createPokemonGateway([PIKACHU]),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /피카츄/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "이 포켓몬 추측" }),
    );
    expect(
      within(
        screen.getByRole("dialog", {
          name: "피카츄로 추측할까요?",
        }),
      ).getByText("전기"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "추측하기" }),
    );

    expect(realtime.guessPokemon).toHaveBeenCalledWith(25, 3);
    await waitFor(() => {
      expect(router.state.location.search).toBe("");
    });
    expect(
      screen.queryByRole("dialog", {
        name: "전국도감",
      }),
    ).not.toBeInTheDocument();
  });

  it("should_disableAlreadyGuessedPokemon_when_pokedexOpens", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(
            QUESTIONER_AFTER_WRONG_GUESS_SNAPSHOT,
          ),
      }),
      pokemonGateway: createPokemonGateway([PIKACHU]),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );
    const alreadyGuessedCard = await screen.findByRole("button", {
      name: /피카츄.*이미 추측함/,
    });

    expect(alreadyGuessedCard).toBeDisabled();
    expect(
      within(alreadyGuessedCard).getByText("이미 추측함"),
    ).toBeInTheDocument();
    fireEvent.click(alreadyGuessedCard);
    expect(
      screen.getByRole("button", { name: "이 포켓몬 추측" }),
    ).toBeDisabled();
    expect(realtime.guessPokemon).not.toHaveBeenCalled();
  });

  it("should_showResult_when_guessAndEndShareStateVersion", async () => {
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");

    act(() => {
      realtime.event({
        ...baseEvent(4),
        eventType: "GUESS_RESOLVED",
        gameId: GAME_ID,
        payload: {
          correct: true,
          guessedPokemon: PIKACHU,
          remainingActionCount: 19,
          sequenceNo: 1,
          usedActionCount: 1,
        },
      });
      realtime.event({
        ...baseEvent(4),
        eventType: "GAME_ENDED",
        gameId: GAME_ID,
        payload: {
          answerPokemon: PIKACHU,
          endReason: "CORRECT_GUESS",
          loserUserId: HOST_MEMBER.userId,
          status: "COMPLETED",
          usedActionCount: 1,
          winnerUserId: GUEST_MEMBER.userId,
        },
      });
    });

    expect(
      await screen.findByRole("heading", { name: "승리했어요" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("피카츄")).not.toHaveLength(0);
    expect(screen.getByText("전기")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockRestore();
  });

  it("should_clearActiveRoomAndHideNextRoundSelection_when_playerLeavesGame", async () => {
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    const setActiveRoomCode = vi.fn();
    const realtime = createRealtimeHarness();
    renderRoom({
      auth: createAuthContextValue({
        currentUser: {
          ...TEST_CURRENT_USER,
          activeRoomCode: "AB3K7M",
        },
        setActiveRoomCode,
        status: "authenticated",
      }),
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");

    act(() => {
      realtime.event({
        ...baseEvent(4),
        eventType: "GAME_ENDED",
        gameId: GAME_ID,
        payload: {
          answerPokemon: PIKACHU,
          endReason: "PLAYER_LEFT",
          loserUserId: HOST_MEMBER.userId,
          status: "COMPLETED",
          usedActionCount: 0,
          winnerUserId: GUEST_MEMBER.userId,
        },
      });
    });

    expect(
      await screen.findByRole("heading", { name: "승리했어요" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("상대가 게임에서 나갔어요."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "재대결 준비" }),
    ).not.toBeInTheDocument();
    expect(setActiveRoomCode).toHaveBeenCalledWith(null);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockRestore();
  });

  it("should_closePokedexAndShowReconnectCountdown_when_opponentDisconnects", async () => {
    const realtime = createRealtimeHarness();
    const { router } = renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByText("내 역할 · 질문자");
    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );
    expect(
      screen.getByRole("dialog", { name: "전국도감" }),
    ).toBeInTheDocument();

    act(() => {
      realtime.event({
        ...baseEvent(4),
        eventType: "PLAYER_CONNECTION_CHANGED",
        gameId: GAME_ID,
        payload: {
          connected: false,
          reconnectDeadline: new Date(
            Date.now() + 60_000,
          ).toISOString(),
          userId: HOST_MEMBER.userId,
        },
      });
    });

    expect(
      await screen.findByRole("dialog", {
        name: "상대 연결이 끊겼어요",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/00:5|01:00/)).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.search).toBe("");
    });
    expect(
      screen.queryByRole("dialog", { name: "전국도감" }),
    ).not.toBeInTheDocument();
  });

  it("should_blockRouteAndResetNavigation_when_activeGameWouldBeLeft", async () => {
    const gateway = createRoomGateway({
      get: vi
        .fn()
        .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
    });
    const { router } = renderRoom({ gateway });
    await screen.findByText("내 역할 · 질문자");

    await act(async () => {
      await router.navigate("/lobby");
    });

    expect(
      await screen.findByRole("dialog", {
        name: "게임에서 나갈까요?",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "계속하기" }),
    );

    expect(router.state.location.pathname).toBe("/rooms/AB3K7M");
    expect(gateway.leave).not.toHaveBeenCalled();
  });

  it("should_preventHardUnload_when_activeGameIsInProgress", async () => {
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
    });
    await screen.findByText("내 역할 · 질문자");
    await waitFor(() => {
      const event = new Event("beforeunload", {
        cancelable: true,
      });

      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  it("should_explainActiveGameGuard_when_logoutIsRequested", async () => {
    renderRoom({
      gateway: createRoomGateway({
        get: vi
          .fn()
          .mockResolvedValue(QUESTIONER_ACTIVE_SNAPSHOT),
      }),
    });
    await screen.findByText("내 역할 · 질문자");

    fireEvent.click(
      screen.getByRole("button", { name: "로그아웃" }),
    );

    expect(
      screen.getByRole("dialog", {
        name: "진행 중인 게임이 있어요",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "로그아웃하려면 먼저 게임에서 나가야 합니다.",
      ),
    ).toBeInTheDocument();
  });

  it("should_submitAndChangeRolePreference_when_resultScreenIsOpen", async () => {
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(RESULT_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", { name: "승리했어요" });
    act(() => {
      realtime.status("connected");
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /포켓몬을 정하고 답하기/,
      }),
    );

    expect(realtime.changeRolePreference).toHaveBeenCalledWith(
      "SELECTOR",
      5,
    );

    act(() => {
      realtime.event({
        ...baseEvent(6),
        eventType: "ROOM_SNAPSHOT",
        gameId: GAME_ID,
        payload: {
          ...RESULT_SNAPSHOT,
          roleSelection: {
            opponentSelected: false,
            preferredRole: "SELECTOR",
          },
          stateVersion: 6,
        },
      });
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: /질문하고 맞히기/,
      }),
    );

    expect(
      realtime.changeRolePreference,
    ).toHaveBeenLastCalledWith("QUESTIONER", 6);
  });

  it("should_scrollToTop_when_nextRoundRoleAssignmentCompletes", async () => {
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    const realtime = createRealtimeHarness();
    renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(RESULT_SNAPSHOT),
      }),
      realtimeGateway: realtime.gateway,
    });
    await screen.findByRole("heading", { name: "승리했어요" });
    scrollTo.mockClear();

    act(() => {
      realtime.event({
        ...baseEvent(6),
        eventType: "ROOM_SNAPSHOT",
        payload: {
          ...QUESTIONER_SELECTION_SNAPSHOT,
          roleAssignment: {
            randomized: true,
          },
          roundNumber: 2,
          stateVersion: 6,
        },
      });
    });

    expect(
      await screen.findByRole("heading", {
        name: "출제자가 포켓몬을 고르고 있어요",
      }),
    ).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockRestore();
  });

  it("should_disableRolePreference_when_resultRealtimeIsDisconnected", async () => {
    renderRoom({
      gateway: createRoomGateway({
        get: vi.fn().mockResolvedValue(RESULT_SNAPSHOT),
      }),
      realtimeGateway: createRealtimeHarness().gateway,
    });

    expect(
      await screen.findByRole("button", {
        name: /포켓몬을 정하고 답하기/,
      }),
    ).toBeDisabled();
  });
});

interface RenderRoomOptions {
  auth?: AuthContextValue;
  gateway?: RoomGateway;
  initialEntry?: string;
  realtimeGateway?: RoomRealtimeGateway;
  pokemonGateway?: PokemonGateway;
  writeClipboard?: (value: string) => Promise<void>;
}

function renderRoom({
  auth = createAuthContextValue({
    currentUser: TEST_CURRENT_USER,
    status: "authenticated",
  }),
  gateway = createRoomGateway(),
  initialEntry = "/rooms/AB3K7M",
  realtimeGateway = createRealtimeHarness().gateway,
  pokemonGateway = createPokemonGateway(),
  writeClipboard = vi.fn().mockResolvedValue(undefined),
}: RenderRoomOptions = {}) {
  const routes: RouteObject[] = [
    {
      element: (
        <RoomPage
          gateway={gateway}
          pokemonGateway={pokemonGateway}
          realtimeGateway={realtimeGateway}
          writeClipboard={writeClipboard}
        />
      ),
      path: "/rooms/:roomCode",
    },
    {
      element: <p>로비 화면</p>,
      path: "/lobby",
    },
  ];
  const router = createMemoryRouter(routes, {
    initialEntries: [initialEntry],
  });
  const rendered = render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return { ...rendered, router };
}

function createRoomGateway(
  overrides: Partial<RoomGateway> = {},
): RoomGateway {
  return {
    create: vi.fn().mockResolvedValue(HOST_SNAPSHOT),
    get: vi.fn().mockResolvedValue(HOST_SNAPSHOT),
    join: vi.fn().mockResolvedValue(TWO_PLAYER_SNAPSHOT),
    leave: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ rooms: [] }),
    ...overrides,
  };
}

function createRealtimeHarness() {
  let handlers: RoomRealtimeHandlers | null = null;
  const close = vi.fn().mockResolvedValue(undefined);
  const answerQuestion = vi.fn().mockReturnValue(COMMAND_ID);
  const askQuestion = vi.fn().mockReturnValue(COMMAND_ID);
  const changeRolePreference = vi
    .fn()
    .mockReturnValue(COMMAND_ID);
  const guessPokemon = vi.fn().mockReturnValue(COMMAND_ID);
  const requestSnapshot = vi.fn().mockReturnValue(COMMAND_ID);
  const selectPokemon = vi.fn().mockReturnValue(COMMAND_ID);
  const session: RoomRealtimeSession = {
    answerQuestion,
    askQuestion,
    changeRolePreference,
    close,
    guessPokemon,
    requestSnapshot,
    selectPokemon,
  };
  const gateway: RoomRealtimeGateway = {
    open: vi.fn((_roomCode, nextHandlers) => {
      handlers = nextHandlers;
      return session;
    }),
  };
  return {
    answerQuestion,
    askQuestion,
    changeRolePreference,
    close,
    event(event: WaitingRoomEvent) {
      handlers?.onEvent(event);
    },
    gateway,
    guessPokemon,
    requestSnapshot,
    selectPokemon,
    status(status: RealtimeConnectionStatus) {
      handlers?.onStatusChange(status);
    },
  };
}

const HOST_MEMBER = {
  connected: true,
  nickname: "레드",
  reconnectDeadline: null,
  role: "SELECTOR" as const,
  userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
};

const GUEST_MEMBER = {
  connected: true,
  nickname: "그린",
  reconnectDeadline: null,
  role: "QUESTIONER" as const,
  userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
};

const HOST_SNAPSHOT: Extract<
  WaitingRoomSnapshot,
  { status: "WAITING_FOR_OPPONENT" }
> = {
  game: null,
  me: {
    ...HOST_MEMBER,
    role: null,
  },
  opponent: null,
  roleAssignment: null,
  roleSelection: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 1,
  status: "WAITING_FOR_OPPONENT",
};

const TWO_PLAYER_SNAPSHOT: Extract<
  WaitingRoomSnapshot,
  { status: "WAITING_FOR_ROLE_SELECTION" }
> = {
  ...HOST_SNAPSHOT,
  opponent: {
    ...GUEST_MEMBER,
    role: null,
  },
  roleAssignment: null,
  roleSelection: {
    opponentSelected: false,
    preferredRole: null,
  },
  stateVersion: 2,
  status: "WAITING_FOR_ROLE_SELECTION",
};

const ASSIGNED_SELECTOR_SELECTION_SNAPSHOT: Extract<
  WaitingRoomSnapshot,
  { status: "WAITING_FOR_SELECTION" }
> = {
  game: null,
  me: HOST_MEMBER,
  opponent: GUEST_MEMBER,
  roleAssignment: {
    randomized: false,
  },
  roleSelection: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 4,
  status: "WAITING_FOR_SELECTION",
};

const QUESTIONER_SELECTION_SNAPSHOT: Extract<
  WaitingRoomSnapshot,
  { status: "WAITING_FOR_SELECTION" }
> = {
  game: null,
  me: GUEST_MEMBER,
  opponent: HOST_MEMBER,
  roleAssignment: {
    randomized: false,
  },
  roleSelection: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 4,
  status: "WAITING_FOR_SELECTION",
};

const GAME_ID = "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e";
const PIKACHU = {
  artworkEnabled: true,
  artworkUrl: "https://example.com/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"] as const,
};
const QUESTIONER_ACTIVE_SNAPSHOT: QuestionerActiveRoomSnapshot = {
  game: {
    actions: [],
    gameId: GAME_ID,
    remainingActionCount: 20,
    status: "IN_PROGRESS",
    usedActionCount: 0,
  },
  me: GUEST_MEMBER,
  opponent: HOST_MEMBER,
  roleAssignment: null,
  roleSelection: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 3,
  status: "PLAYING",
};
const QUESTIONER_AFTER_WRONG_GUESS_SNAPSHOT: QuestionerActiveRoomSnapshot =
  {
    ...QUESTIONER_ACTIVE_SNAPSHOT,
    game: {
      ...QUESTIONER_ACTIVE_SNAPSHOT.game,
      actions: [
        {
          correct: false,
          createdAt: "2026-07-25T03:00:00Z",
          guessedPokemon: PIKACHU,
          guessedPokemonNationalDexId: PIKACHU.nationalDexId,
          sequenceNumber: 1,
          type: "GUESS",
        },
      ],
      remainingActionCount: 19,
      usedActionCount: 1,
    },
    stateVersion: 4,
  };
const QUESTIONER_PENDING_SNAPSHOT: QuestionerActiveRoomSnapshot = {
  ...QUESTIONER_ACTIVE_SNAPSHOT,
  game: {
    ...QUESTIONER_ACTIVE_SNAPSHOT.game,
    actions: [
      {
        answer: null,
        answeredAt: null,
        comment: null,
        createdAt: "2026-07-25T03:00:00Z",
        question: "날개가 있나요?",
        sequenceNumber: 1,
        type: "QUESTION",
      },
    ],
    remainingActionCount: 19,
    usedActionCount: 1,
  },
  stateVersion: 4,
};
const QUESTIONER_NO_ACTION_SNAPSHOT: QuestionerActiveRoomSnapshot = {
  ...QUESTIONER_ACTIVE_SNAPSHOT,
  game: {
    ...QUESTIONER_ACTIVE_SNAPSHOT.game,
    remainingActionCount: 0,
    usedActionCount: 20,
  },
  stateVersion: 23,
};
const SELECTOR_ACTIVE_SNAPSHOT: SelectorActiveRoomSnapshot = {
  game: {
    actions: [],
    gameId: GAME_ID,
    remainingActionCount: 20,
    selectedPokemon: PIKACHU,
    status: "IN_PROGRESS",
    usedActionCount: 0,
  },
  me: HOST_MEMBER,
  opponent: GUEST_MEMBER,
  roleAssignment: null,
  roleSelection: null,
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 3,
  status: "PLAYING",
};
const SELECTOR_PENDING_SNAPSHOT: SelectorActiveRoomSnapshot = {
  ...SELECTOR_ACTIVE_SNAPSHOT,
  game: {
    ...SELECTOR_ACTIVE_SNAPSHOT.game,
    actions: [
      {
        answer: null,
        answeredAt: null,
        comment: null,
        createdAt: "2026-07-25T03:00:00Z",
        question: "날개가 있나요?",
        sequenceNumber: 1,
        type: "QUESTION",
      },
    ],
    remainingActionCount: 19,
    usedActionCount: 1,
  },
  stateVersion: 4,
};
const RESULT_SNAPSHOT: ResultRoomSnapshot = {
  game: {
    actions: [],
    answerPokemon: PIKACHU,
    endReason: "QUESTION_LIMIT",
    gameId: GAME_ID,
    loserUserId: HOST_MEMBER.userId,
    remainingActionCount: 15,
    status: "COMPLETED",
    usedActionCount: 5,
    winnerUserId: GUEST_MEMBER.userId,
  },
  me: GUEST_MEMBER,
  opponent: HOST_MEMBER,
  roleAssignment: null,
  roleSelection: {
    opponentSelected: false,
    preferredRole: null,
  },
  roomCode: "AB3K7M",
  roundNumber: 1,
  stateVersion: 5,
  status: "RESULT",
};

function baseEvent(stateVersion: number) {
  return {
    eventId: "2069dc9a-624f-48f9-8b2c-65e912006224",
    gameId: null,
    occurredAt: "2026-07-25T03:00:00Z",
    roomCode: "AB3K7M",
    stateVersion,
  };
}

const COMMAND_ID = "98835cf8-c6f2-4576-a900-b26519ddbbed";

function createPokemonGateway(
  content: readonly typeof PIKACHU[] = [],
): PokemonGateway {
  return {
    findEvolutionDetails: vi.fn().mockResolvedValue({
      nextEvolutions: [],
      pokemon: PIKACHU,
      previousEvolution: null,
    }),
    findByNationalDexId: vi.fn().mockResolvedValue({
      artworkEnabled: true,
      artworkUrl: "https://example.com/25.png",
      generation: 1,
      koreanName: "피카츄",
      nationalDexId: 25,
      types: ["ELECTRIC"] as const,
    }),
    search: vi.fn().mockResolvedValue({
      content,
      page: 0,
      size: 20,
      totalElements: content.length,
      totalPages: content.length === 0 ? 0 : 1,
    }),
  };
}

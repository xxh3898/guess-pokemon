package com.guesspokemon.realtime;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.game.GameRuleException;
import com.guesspokemon.realtime.RealtimeDtos.AnswerQuestionPayload;
import com.guesspokemon.realtime.RealtimeDtos.AskQuestionPayload;
import com.guesspokemon.realtime.RealtimeDtos.CommandEnvelope;
import com.guesspokemon.realtime.RealtimeDtos.GuessPokemonPayload;
import com.guesspokemon.realtime.RealtimeDtos.RealtimeError;
import com.guesspokemon.realtime.RealtimeDtos.RematchReadyPayload;
import com.guesspokemon.realtime.RealtimeDtos.ResumePayload;
import com.guesspokemon.realtime.RealtimeDtos.SelectPokemonPayload;
import com.guesspokemon.room.RoomApplicationService;
import com.guesspokemon.room.RoomApplicationService.CommandOutcome;
import com.guesspokemon.room.RoomApplicationService.RematchOutcome;
import com.guesspokemon.security.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.ConstraintViolationException;
import java.security.Principal;
import java.util.EnumMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.converter.MessageConversionException;
import org.springframework.messaging.handler.annotation.support.MethodArgumentNotValidException;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Controller
@Validated
class RealtimeCommandController {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(
                    RealtimeCommandController.class);
    private static final Map<GameRuleException.GameRuleError, String>
            GAME_ERROR_MESSAGES = gameErrorMessages();

    private final RoomApplicationService roomApplicationService;
    private final RoomConnectionService roomConnectionService;
    private final RealtimeEventPublisher eventPublisher;

    RealtimeCommandController(
            RoomApplicationService roomApplicationService,
            RoomConnectionService roomConnectionService,
            RealtimeEventPublisher eventPublisher) {
        this.roomApplicationService = roomApplicationService;
        this.roomConnectionService = roomConnectionService;
        this.eventPublisher = eventPublisher;
    }

    @MessageMapping("/rooms/{roomCode}/select-pokemon")
    void selectPokemon(
            @DestinationVariable String roomCode,
            @Payload @Valid
                    CommandEnvelope<SelectPokemonPayload>
                            command,
            @Header(
                            SimpMessageHeaderAccessor
                                    .SESSION_ID_HEADER)
                    String sessionId,
            Principal principal) {
        AuthenticatedUser user = requireUser(principal);
        execute(
                roomCode,
                user.id(),
                command.commandId(),
                () -> {
                    CommandOutcome outcome =
                            roomApplicationService
                                    .selectPokemon(
                                            roomCode,
                                            user.id(),
                                            command.commandId(),
                                            command.expectedStateVersion(),
                                            command.payload()
                                                    .nationalDexId());
                    roomConnectionService.associate(
                            sessionId,
                            user.id(),
                            roomCode);
                    eventPublisher.publishRoundStarted(
                            outcome);
                });
    }

    @MessageMapping("/rooms/{roomCode}/ask")
    void askQuestion(
            @DestinationVariable String roomCode,
            @Payload @Valid
                    CommandEnvelope<AskQuestionPayload>
                            command,
            @Header(
                            SimpMessageHeaderAccessor
                                    .SESSION_ID_HEADER)
                    String sessionId,
            Principal principal) {
        AuthenticatedUser user = requireUser(principal);
        execute(
                roomCode,
                user.id(),
                command.commandId(),
                () -> {
                    CommandOutcome outcome =
                            roomApplicationService.askQuestion(
                                    roomCode,
                                    user.id(),
                                    command.commandId(),
                                    command.expectedStateVersion(),
                                    command.payload().question());
                    roomConnectionService.associate(
                            sessionId,
                            user.id(),
                            roomCode);
                    eventPublisher.publishQuestionAsked(
                            outcome);
                });
    }

    @MessageMapping("/rooms/{roomCode}/answer")
    void answerQuestion(
            @DestinationVariable String roomCode,
            @Payload @Valid
                    CommandEnvelope<AnswerQuestionPayload>
                            command,
            @Header(
                            SimpMessageHeaderAccessor
                                    .SESSION_ID_HEADER)
                    String sessionId,
            Principal principal) {
        AuthenticatedUser user = requireUser(principal);
        execute(
                roomCode,
                user.id(),
                command.commandId(),
                () -> {
                    CommandOutcome outcome =
                            roomApplicationService
                                    .answerQuestion(
                                            roomCode,
                                            user.id(),
                                            command.commandId(),
                                            command.expectedStateVersion(),
                                            command.payload().answer(),
                                            command.payload().comment());
                    roomConnectionService.associate(
                            sessionId,
                            user.id(),
                            roomCode);
                    eventPublisher
                            .publishQuestionAnswered(
                                    outcome);
                    if (outcome.gameEnded()) {
                        roomConnectionService
                                .cancelRoomTimeouts(
                                        roomCode);
                    }
                });
    }

    @MessageMapping("/rooms/{roomCode}/guess")
    void guessPokemon(
            @DestinationVariable String roomCode,
            @Payload @Valid
                    CommandEnvelope<GuessPokemonPayload>
                            command,
            @Header(
                            SimpMessageHeaderAccessor
                                    .SESSION_ID_HEADER)
                    String sessionId,
            Principal principal) {
        AuthenticatedUser user = requireUser(principal);
        execute(
                roomCode,
                user.id(),
                command.commandId(),
                () -> {
                    CommandOutcome outcome =
                            roomApplicationService
                                    .guessPokemon(
                                            roomCode,
                                            user.id(),
                                            command.commandId(),
                                            command.expectedStateVersion(),
                                            command.payload()
                                                    .nationalDexId());
                    roomConnectionService.associate(
                            sessionId,
                            user.id(),
                            roomCode);
                    eventPublisher.publishGuessResolved(
                            outcome);
                    if (outcome.gameEnded()) {
                        roomConnectionService
                                .cancelRoomTimeouts(
                                        roomCode);
                    }
                });
    }

    @MessageMapping("/rooms/{roomCode}/resume")
    void resume(
            @DestinationVariable String roomCode,
            @Payload @Valid
                    CommandEnvelope<ResumePayload> command,
            @Header(
                            SimpMessageHeaderAccessor
                                    .SESSION_ID_HEADER)
                    String sessionId,
            Principal principal) {
        AuthenticatedUser user = requireUser(principal);
        execute(
                roomCode,
                user.id(),
                command.commandId(),
                () ->
                        roomConnectionService.resume(
                                sessionId,
                                user.id(),
                                roomCode));
    }

    @MessageMapping("/rooms/{roomCode}/rematch-ready")
    void changeRematchReady(
            @DestinationVariable String roomCode,
            @Payload @Valid
                    CommandEnvelope<RematchReadyPayload>
                            command,
            @Header(
                            SimpMessageHeaderAccessor
                                    .SESSION_ID_HEADER)
                    String sessionId,
            Principal principal) {
        AuthenticatedUser user = requireUser(principal);
        execute(
                roomCode,
                user.id(),
                command.commandId(),
                () -> {
                    RematchOutcome outcome =
                            roomApplicationService
                                    .changeRematchReady(
                                            roomCode,
                                            user.id(),
                                            command.commandId(),
                                            command.expectedStateVersion(),
                                            command.payload().ready());
                    roomConnectionService.associate(
                            sessionId,
                            user.id(),
                            roomCode);
                    eventPublisher.publishRematch(
                            outcome);
                });
    }

    @MessageExceptionHandler(RealtimeCommandException.class)
    @SendToUser(WebSocketConfig.ERROR_QUEUE)
    RealtimeError handleCommandException(
            RealtimeCommandException exception) {
        RuntimeException cause =
                (RuntimeException) exception.getCause();
        if (cause instanceof ApiException apiException) {
            return new RealtimeError(
                    exception.commandId(),
                    apiException.errorCode().name(),
                    apiException.errorCode().detail(),
                    false,
                    exception.latestStateVersion());
        }
        if (cause
                instanceof GameRuleException gameException) {
            return new RealtimeError(
                    exception.commandId(),
                    gameException.error().name(),
                    GAME_ERROR_MESSAGES.get(
                            gameException.error()),
                    isRecoverable(gameException.error()),
                    exception.latestStateVersion());
        }
        if (cause instanceof IllegalArgumentException) {
            return new RealtimeError(
                    exception.commandId(),
                    "VALIDATION_FAILED",
                    "요청 입력값을 확인해 주세요.",
                    true,
                    exception.latestStateVersion());
        }
        LOGGER.error(
                "Unhandled STOMP command exception exceptionType={}",
                cause.getClass().getName());
        return internalError(
                exception.commandId(),
                exception.latestStateVersion());
    }

    @MessageExceptionHandler(Exception.class)
    @SendToUser(WebSocketConfig.ERROR_QUEUE)
    RealtimeError handleUnexpectedException(
            Exception exception) {
        LOGGER.error(
                "Unhandled STOMP exception exceptionType={}",
                exception.getClass().getName());
        return internalError(null, null);
    }

    @MessageExceptionHandler({
        MethodArgumentNotValidException.class,
        ConstraintViolationException.class,
        MessageConversionException.class
    })
    @SendToUser(WebSocketConfig.ERROR_QUEUE)
    RealtimeError handleValidationException(
            Exception exception) {
        return new RealtimeError(
                null,
                "VALIDATION_FAILED",
                "요청 입력값을 확인해 주세요.",
                true,
                null);
    }

    private void execute(
            String roomCode,
            UUID userId,
            UUID commandId,
            Runnable command) {
        try {
            command.run();
        } catch (RuntimeException exception) {
            throw new RealtimeCommandException(
                    commandId,
                    latestStateVersion(
                            roomCode,
                            userId),
                    exception);
        }
    }

    private Long latestStateVersion(
            String roomCode,
            UUID userId) {
        try {
            return roomApplicationService
                    .latestStateVersion(
                            roomCode,
                            userId);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private AuthenticatedUser requireUser(
            Principal principal) {
        if (principal instanceof Authentication authentication
                && authentication.getPrincipal()
                        instanceof AuthenticatedUser user) {
            return user;
        }
        throw new IllegalStateException(
                "인증 principal이 없습니다.");
    }

    private RealtimeError internalError(
            UUID commandId,
            Long latestStateVersion) {
        return new RealtimeError(
                commandId,
                "INTERNAL_ERROR",
                "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
                true,
                latestStateVersion);
    }

    private boolean isRecoverable(
            GameRuleException.GameRuleError error) {
        return switch (error) {
            case PERSISTENCE_CONFLICT, INVALID_GAME_STATE, INVALID_ROLE ->
                    false;
            default -> true;
        };
    }

    private static Map<GameRuleException.GameRuleError, String>
            gameErrorMessages() {
        Map<GameRuleException.GameRuleError, String> messages =
                new EnumMap<>(
                        GameRuleException.GameRuleError.class);
        messages.put(
                GameRuleException.GameRuleError.INVALID_ROLE,
                "현재 역할로 실행할 수 없는 행동입니다.");
        messages.put(
                GameRuleException.GameRuleError.INVALID_GAME_STATE,
                "현재 경기 상태에서 실행할 수 없는 행동입니다.");
        messages.put(
                GameRuleException.GameRuleError.ANSWER_PENDING,
                "현재 질문의 답변을 기다리고 있습니다.");
        messages.put(
                GameRuleException.GameRuleError.NO_PENDING_QUESTION,
                "답변할 질문이 없습니다.");
        messages.put(
                GameRuleException.GameRuleError.ACTION_LIMIT_REACHED,
                "질문과 추측 기회를 모두 사용했습니다.");
        messages.put(
                GameRuleException.GameRuleError.DUPLICATE_COMMAND,
                "이미 처리한 요청입니다.");
        messages.put(
                GameRuleException.GameRuleError.POKEMON_ALREADY_GUESSED,
                "이 경기에서 이미 추측한 포켓몬입니다.");
        messages.put(
                GameRuleException.GameRuleError.STALE_ROOM_STATE,
                "방 상태가 바뀌었습니다. 최신 상태를 다시 불러와 주세요.");
        messages.put(
                GameRuleException.GameRuleError.POKEMON_NOT_FOUND,
                "요청한 포켓몬을 찾을 수 없습니다.");
        messages.put(
                GameRuleException.GameRuleError.VALIDATION_FAILED,
                "요청 입력값을 확인해 주세요.");
        messages.put(
                GameRuleException.GameRuleError.PERSISTENCE_CONFLICT,
                "경기 상태를 저장하지 못했습니다. 최신 상태를 다시 불러와 주세요.");
        return Map.copyOf(messages);
    }
}

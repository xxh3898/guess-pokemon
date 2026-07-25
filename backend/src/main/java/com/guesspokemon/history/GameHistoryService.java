package com.guesspokemon.history;

import static com.guesspokemon.common.error.ApiErrorCode.GAME_NOT_FOUND;
import static com.guesspokemon.common.error.ApiErrorCode.VALIDATION_FAILED;
import static com.guesspokemon.game.GameTypes.GameActionType.GUESS;
import static com.guesspokemon.game.GameTypes.GameActionType.QUESTION;
import static com.guesspokemon.game.GameTypes.GameResult.LOSS;
import static com.guesspokemon.game.GameTypes.GameResult.NONE;
import static com.guesspokemon.game.GameTypes.GameResult.WIN;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.ABORTED;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.game.GameTypes.GameActionType;
import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameResult;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameTypes.GameStatus;
import com.guesspokemon.history.GameActionRecordRepository.GameActionRow;
import com.guesspokemon.history.GameHistoryDtos.GameActionItem;
import com.guesspokemon.history.GameHistoryDtos.GameDetail;
import com.guesspokemon.history.GameHistoryDtos.GameListItem;
import com.guesspokemon.history.GameHistoryDtos.GamePage;
import com.guesspokemon.history.GameHistoryDtos.GameParticipant;
import com.guesspokemon.history.GameHistoryDtos.OpponentSummary;
import com.guesspokemon.history.GameParticipantRecordRepository.GameParticipantRow;
import com.guesspokemon.history.GameRecordRepository.GameDetailRow;
import com.guesspokemon.history.GameRecordRepository.GameListRow;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class GameHistoryService {

    private static final int MAX_PAGE_SIZE = 100;

    private final GameRecordRepository gameRecordRepository;
    private final GameParticipantRecordRepository
            gameParticipantRecordRepository;
    private final GameActionRecordRepository
            gameActionRecordRepository;
    private final boolean artworkEnabled;

    public GameHistoryService(
            GameRecordRepository gameRecordRepository,
            GameParticipantRecordRepository
                    gameParticipantRecordRepository,
            GameActionRecordRepository gameActionRecordRepository,
            @Value("${pokemon.catalog.artwork-enabled:true}")
                    boolean artworkEnabled) {
        this.gameRecordRepository = gameRecordRepository;
        this.gameParticipantRecordRepository =
                gameParticipantRecordRepository;
        this.gameActionRecordRepository =
                gameActionRecordRepository;
        this.artworkEnabled = artworkEnabled;
    }

    public GamePage list(
            UUID currentUserId,
            GameResult result,
            int page,
            int size) {
        requireUserId(currentUserId);
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ApiException(VALIDATION_FAILED);
        }
        Page<GameListRow> resultPage =
                gameRecordRepository.findHistoryPage(
                        currentUserId,
                        result == null ? null : result.name(),
                        PageRequest.of(page, size));
        return new GamePage(
                resultPage.getContent().stream()
                        .map(this::toListItem)
                        .toList(),
                resultPage.getNumber(),
                resultPage.getSize(),
                resultPage.getTotalElements(),
                resultPage.getTotalPages());
    }

    public GameDetail findDetail(
            UUID currentUserId,
            UUID gameId) {
        requireUserId(currentUserId);
        Objects.requireNonNull(gameId);
        GameDetailRow game =
                gameRecordRepository
                        .findHistoryDetail(
                                gameId,
                                currentUserId)
                        .orElseThrow(
                                () ->
                                        new ApiException(
                                                GAME_NOT_FOUND));
        List<GameParticipant> participants =
                gameParticipantRecordRepository
                        .findHistoryParticipants(
                                gameId,
                                currentUserId)
                        .stream()
                        .map(this::toParticipant)
                        .toList();
        List<GameActionItem> actions =
                gameActionRecordRepository
                        .findHistoryActions(gameId)
                        .stream()
                        .map(this::toAction)
                        .toList();
        GameStatus status = enumValue(GameStatus.class, game.getStatus());
        validateDetail(
                currentUserId,
                status,
                game.getActionCount(),
                participants,
                actions);
        return new GameDetail(
                game.getGameId(),
                status,
                game.getStartedAt(),
                game.getEndedAt(),
                toPokemon(
                        game.getAnswerNationalDexId(),
                        game.getAnswerKoreanName(),
                        game.getAnswerGeneration(),
                        game.getAnswerArtworkUrl(),
                        game.getAnswerCatalogEnabled()),
                enumValue(
                        GameEndReason.class,
                        game.getEndReason()),
                game.getActionCount(),
                participants,
                actions);
    }

    private GameListItem toListItem(GameListRow row) {
        return new GameListItem(
                row.getGameId(),
                row.getStartedAt(),
                row.getEndedAt(),
                enumValue(GameRole.class, row.getMyRole()),
                enumValue(GameResult.class, row.getMyResult()),
                new OpponentSummary(
                        row.getOpponentId(),
                        row.getOpponentNickname()),
                toPokemon(
                        row.getAnswerNationalDexId(),
                        row.getAnswerKoreanName(),
                        row.getAnswerGeneration(),
                        row.getAnswerArtworkUrl(),
                        row.getAnswerCatalogEnabled()),
                enumValue(
                        GameEndReason.class,
                        row.getEndReason()),
                row.getActionCount());
    }

    private GameParticipant toParticipant(
            GameParticipantRow row) {
        return new GameParticipant(
                row.getUserId(),
                row.getNickname(),
                enumValue(GameRole.class, row.getRole()),
                enumValue(GameResult.class, row.getResult()));
    }

    private GameActionItem toAction(GameActionRow row) {
        GameActionType type =
                enumValue(GameActionType.class, row.getType());
        GameAnswer answer =
                row.getAnswer() == null
                        ? null
                        : enumValue(
                                GameAnswer.class,
                                row.getAnswer());
        PokemonSummary guessedPokemon =
                row.getGuessedNationalDexId() == null
                        ? null
                        : toPokemon(
                                row.getGuessedNationalDexId(),
                                row.getGuessedKoreanName(),
                                row.getGuessedGeneration(),
                                row.getGuessedArtworkUrl(),
                                row.getGuessedCatalogEnabled());
        return new GameActionItem(
                row.getSequenceNo(),
                type,
                row.getQuestion(),
                answer,
                guessedPokemon,
                row.getCorrect(),
                row.getCreatedAt(),
                row.getAnsweredAt());
    }

    private PokemonSummary toPokemon(
            Integer nationalDexId,
            String koreanName,
            Short generation,
            String artworkUrl,
            Boolean catalogEnabled) {
        Objects.requireNonNull(nationalDexId);
        Objects.requireNonNull(koreanName);
        Objects.requireNonNull(generation);
        boolean canUseArtwork =
                artworkEnabled
                        && Boolean.TRUE.equals(catalogEnabled);
        return new PokemonSummary(
                nationalDexId,
                koreanName,
                generation,
                canUseArtwork ? artworkUrl : null,
                canUseArtwork);
    }

    private void validateDetail(
            UUID currentUserId,
            GameStatus status,
            Short actionCount,
            List<GameParticipant> participants,
            List<GameActionItem> actions) {
        if (participants.size() != 2
                || actionCount == null
                || actionCount != actions.size()) {
            throw invalidHistoryState();
        }
        Set<UUID> userIds = new HashSet<>();
        Set<GameRole> roles =
                EnumSet.noneOf(GameRole.class);
        long winCount = 0;
        long lossCount = 0;
        long noneCount = 0;
        for (GameParticipant participant : participants) {
            userIds.add(participant.userId());
            roles.add(participant.role());
            if (participant.result() == WIN) {
                winCount++;
            } else if (participant.result() == LOSS) {
                lossCount++;
            } else if (participant.result() == NONE) {
                noneCount++;
            }
        }
        boolean participantShapeValid =
                userIds.size() == 2
                        && userIds.contains(currentUserId)
                        && roles.equals(
                                EnumSet.of(
                                        SELECTOR,
                                        QUESTIONER));
        boolean resultShapeValid =
                (status == COMPLETED
                                && winCount == 1
                                && lossCount == 1
                                && noneCount == 0)
                        || (status == ABORTED
                                && winCount == 0
                                && lossCount == 0
                                && noneCount == 2);
        if (!participantShapeValid || !resultShapeValid) {
            throw invalidHistoryState();
        }
        for (int index = 0; index < actions.size(); index++) {
            GameActionItem action = actions.get(index);
            if (action.sequenceNo() != index + 1
                    || !isValidAction(action)) {
                throw invalidHistoryState();
            }
        }
    }

    private boolean isValidAction(GameActionItem action) {
        if (action.type() == QUESTION) {
            return action.question() != null
                    && action.guessedPokemon() == null
                    && action.correct() == null
                    && ((action.answer() == null
                                    && action.answeredAt() == null)
                            || (action.answer() != null
                                    && action.answeredAt() != null));
        }
        if (action.type() == GUESS) {
            return action.question() == null
                    && action.answer() == null
                    && action.guessedPokemon() != null
                    && action.correct() != null
                    && action.answeredAt() == null;
        }
        return false;
    }

    private void requireUserId(UUID userId) {
        if (userId == null) {
            throw new ApiException(VALIDATION_FAILED);
        }
    }

    private IllegalStateException invalidHistoryState() {
        return new IllegalStateException(
                "경기 기록의 저장 상태가 올바르지 않습니다.");
    }

    private <T extends Enum<T>> T enumValue(
            Class<T> enumType,
            String value) {
        return Enum.valueOf(
                enumType,
                Objects.requireNonNull(value));
    }
}

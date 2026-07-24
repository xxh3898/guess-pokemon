package com.guesspokemon.history;

import static com.guesspokemon.game.GameRuleException.GameRuleError.PERSISTENCE_CONFLICT;
import static com.guesspokemon.game.GameTypes.GameResult.LOSS;
import static com.guesspokemon.game.GameTypes.GameResult.NONE;
import static com.guesspokemon.game.GameTypes.GameResult.WIN;
import static com.guesspokemon.game.GameTypes.GameRole.QUESTIONER;
import static com.guesspokemon.game.GameTypes.GameRole.SELECTOR;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static com.guesspokemon.game.GameTypes.GameStatus.IN_PROGRESS;

import com.guesspokemon.game.GamePersistencePort;
import com.guesspokemon.game.GameRuleException;
import com.guesspokemon.game.GameTypes.GameRole;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class JpaGameHistoryStore
        implements GamePersistencePort {

    private final GameRecordRepository gameRecordRepository;
    private final GameParticipantRecordRepository
            gameParticipantRecordRepository;
    private final GameActionRecordRepository
            gameActionRecordRepository;

    public JpaGameHistoryStore(
            GameRecordRepository gameRecordRepository,
            GameParticipantRecordRepository
                    gameParticipantRecordRepository,
            GameActionRecordRepository
                    gameActionRecordRepository) {
        this.gameRecordRepository = gameRecordRepository;
        this.gameParticipantRecordRepository =
                gameParticipantRecordRepository;
        this.gameActionRecordRepository =
                gameActionRecordRepository;
    }

    @Override
    @Transactional
    public void createGame(GameState gameState) {
        validateParticipants(gameState);
        if (gameState.status() != IN_PROGRESS
                || gameState.actionCount() != 0
                || gameState.endReason() != null
                || gameState.endedAt() != null) {
            throw new GameRuleException(PERSISTENCE_CONFLICT);
        }

        gameRecordRepository.saveAndFlush(
                GameRecord.create(gameState));
        List<GameParticipantRecord> participants =
                gameState.participants().stream()
                        .map(
                                participant ->
                                        GameParticipantRecord.create(
                                                gameState.gameId(),
                                                participant))
                        .toList();
        gameParticipantRecordRepository
                .saveAllAndFlush(participants);
    }

    @Override
    @Transactional
    public void appendAction(
            long expectedPreviousVersion,
            GameState gameState,
            ActionState actionState) {
        validateParticipants(gameState);
        GameRecord gameRecord =
                requireGameAtVersion(
                        gameState.gameId(),
                        expectedPreviousVersion);
        gameActionRecordRepository.save(
                GameActionRecord.create(
                        gameState.gameId(),
                        actionState));
        gameRecord.apply(
                gameState,
                actionState.createdAt());
        applyParticipantResults(gameState);
        flushAll();
    }

    @Override
    @Transactional
    public void updateAnsweredQuestion(
            long expectedPreviousVersion,
            GameState gameState,
            ActionState actionState) {
        validateParticipants(gameState);
        GameRecord gameRecord =
                requireGameAtVersion(
                        gameState.gameId(),
                        expectedPreviousVersion);
        GameActionRecord actionRecord =
                gameActionRecordRepository
                        .findByGameIdAndSequenceNumber(
                                gameState.gameId(),
                                (short) actionState
                                        .sequenceNumber())
                        .orElseThrow(
                                () ->
                                        new GameRuleException(
                                                PERSISTENCE_CONFLICT));
        actionRecord.applyAnswer(actionState);
        gameRecord.apply(
                gameState,
                actionState.answeredAt());
        applyParticipantResults(gameState);
        flushAll();
    }

    @Override
    @Transactional(readOnly = true)
    public boolean actionCommandExists(UUID commandId) {
        return gameActionRecordRepository
                .existsByCommandId(commandId);
    }

    @Override
    @Transactional
    public int abortInProgressGames(Instant endedAt) {
        List<GameRecord> inProgressGames =
                gameRecordRepository.findAllByStatus(
                        IN_PROGRESS);
        for (GameRecord gameRecord : inProgressGames) {
            gameRecord.abortForServerRestart(endedAt);
            List<GameParticipantRecord> participants =
                    gameParticipantRecordRepository
                            .findAllByIdGameId(
                                    gameRecord.getId());
            if (participants.size() != 2) {
                throw new GameRuleException(
                        PERSISTENCE_CONFLICT);
            }
            participants.forEach(
                    participant ->
                            participant.updateResult(NONE));
        }
        flushAll();
        return inProgressGames.size();
    }

    private GameRecord requireGameAtVersion(
            UUID gameId,
            long expectedPreviousVersion) {
        GameRecord gameRecord =
                gameRecordRepository
                        .findById(gameId)
                        .orElseThrow(
                                () ->
                                        new GameRuleException(
                                                PERSISTENCE_CONFLICT));
        if (gameRecord.getStateVersion()
                != expectedPreviousVersion) {
            throw new GameRuleException(
                    PERSISTENCE_CONFLICT);
        }
        return gameRecord;
    }

    private void applyParticipantResults(
            GameState gameState) {
        List<GameParticipantRecord> records =
                gameParticipantRecordRepository
                        .findAllByIdGameId(
                                gameState.gameId());
        if (records.size() != 2) {
            throw new GameRuleException(
                    PERSISTENCE_CONFLICT);
        }
        for (GameParticipantRecord record : records) {
            ParticipantState expected =
                    gameState.participants().stream()
                            .filter(
                                    participant ->
                                            participant
                                                    .userId()
                                                    .equals(
                                                            record
                                                                    .getId()
                                                                    .getUserId()))
                            .findFirst()
                            .orElseThrow(
                                    () ->
                                            new GameRuleException(
                                                    PERSISTENCE_CONFLICT));
            if (record.getRole() != expected.role()) {
                throw new GameRuleException(
                        PERSISTENCE_CONFLICT);
            }
            record.updateResult(expected.result());
        }
    }

    private void validateParticipants(GameState gameState) {
        List<ParticipantState> participants =
                gameState.participants();
        Set<GameRole> roles =
                participants.stream()
                        .map(ParticipantState::role)
                        .collect(
                                () -> EnumSet.noneOf(GameRole.class),
                                EnumSet::add,
                                EnumSet::addAll);
        Set<UUID> userIds =
                participants.stream()
                        .map(ParticipantState::userId)
                        .collect(java.util.stream.Collectors.toSet());
        if (participants.size() != 2
                || userIds.size() != 2
                || !roles.equals(
                        EnumSet.of(SELECTOR, QUESTIONER))) {
            throw new GameRuleException(
                    PERSISTENCE_CONFLICT);
        }

        long winCount =
                participants.stream()
                        .filter(
                                participant ->
                                        participant.result()
                                                == WIN)
                        .count();
        long lossCount =
                participants.stream()
                        .filter(
                                participant ->
                                        participant.result()
                                                == LOSS)
                        .count();
        long noneCount =
                participants.stream()
                        .filter(
                                participant ->
                                        participant.result()
                                                == NONE)
                        .count();
        if (gameState.status() == COMPLETED) {
            if (winCount != 1
                    || lossCount != 1
                    || noneCount != 0) {
                throw new GameRuleException(
                        PERSISTENCE_CONFLICT);
            }
        } else if (noneCount != 2) {
            throw new GameRuleException(
                    PERSISTENCE_CONFLICT);
        }
    }

    private void flushAll() {
        gameActionRecordRepository.flush();
        gameParticipantRecordRepository.flush();
        gameRecordRepository.flush();
    }
}

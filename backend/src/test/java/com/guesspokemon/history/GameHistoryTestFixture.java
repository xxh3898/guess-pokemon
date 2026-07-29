package com.guesspokemon.history;

import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameResult;
import com.guesspokemon.game.GameTypes.GameStatus;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

final class GameHistoryTestFixture {

    private static final int ANSWER_POKEMON_ID = 25;

    private final JdbcClient jdbcClient;
    private final AppUserRepository appUserRepository;

    GameHistoryTestFixture(
            JdbcClient jdbcClient,
            AppUserRepository appUserRepository) {
        this.jdbcClient = jdbcClient;
        this.appUserRepository = appUserRepository;
    }

    AppUser saveUser(
            String loginId,
            String nickname) {
        return appUserRepository.saveAndFlush(
                AppUser.create(
                        loginId,
                        loginId,
                        nickname,
                        nickname,
                        "{noop}test-only-password",
                        Instant.parse(
                                "2026-07-25T00:00:00Z")));
    }

    void insertEndedGame(
            UUID gameId,
            UUID selectorUserId,
            UUID questionerUserId,
            GameStatus status,
            GameEndReason endReason,
            GameResult selectorResult,
            GameResult questionerResult,
            int actionCount,
            Instant startedAt,
            Instant endedAt) {
        jdbcClient
                .sql(
                        """
                        INSERT INTO game (
                            id,
                            round_group_id,
                            mode,
                            answer_pokemon_id,
                            status,
                            end_reason,
                            action_count,
                            state_version,
                            started_at,
                            ended_at,
                            created_at,
                            updated_at
                        )
                        VALUES (
                            :gameId,
                            :roundGroupId,
                            'TWENTY_QUESTIONS',
                            :answerPokemonId,
                            :status,
                            :endReason,
                            :actionCount,
                            10,
                            :startedAt,
                            :endedAt,
                            :startedAt,
                            :endedAt
                        )
                        """)
                .param("gameId", gameId)
                .param("roundGroupId", gameId)
                .param(
                        "answerPokemonId",
                        ANSWER_POKEMON_ID)
                .param("status", status.name())
                .param("endReason", endReason.name())
                .param("actionCount", actionCount)
                .param("startedAt", timestamp(startedAt))
                .param("endedAt", timestamp(endedAt))
                .update();
        insertParticipants(
                gameId,
                selectorUserId,
                questionerUserId,
                selectorResult,
                questionerResult,
                startedAt);
    }

    void insertInProgressGame(
            UUID gameId,
            UUID selectorUserId,
            UUID questionerUserId,
            Instant startedAt) {
        jdbcClient
                .sql(
                        """
                        INSERT INTO game (
                            id,
                            round_group_id,
                            mode,
                            answer_pokemon_id,
                            status,
                            end_reason,
                            action_count,
                            state_version,
                            started_at,
                            ended_at,
                            created_at,
                            updated_at
                        )
                        VALUES (
                            :gameId,
                            :roundGroupId,
                            'TWENTY_QUESTIONS',
                            :answerPokemonId,
                            'IN_PROGRESS',
                            NULL,
                            0,
                            3,
                            :startedAt,
                            NULL,
                            :startedAt,
                            :startedAt
                        )
                        """)
                .param("gameId", gameId)
                .param("roundGroupId", gameId)
                .param(
                        "answerPokemonId",
                        ANSWER_POKEMON_ID)
                .param("startedAt", timestamp(startedAt))
                .update();
        insertParticipants(
                gameId,
                selectorUserId,
                questionerUserId,
                GameResult.NONE,
                GameResult.NONE,
                startedAt);
    }

    void insertAnsweredQuestion(
            UUID gameId,
            UUID questionerUserId,
            int sequenceNumber,
            String question,
            GameAnswer answer,
            String comment,
            Instant createdAt,
            Instant answeredAt) {
        jdbcClient
                .sql(
                        """
                        INSERT INTO game_action (
                            id,
                            command_id,
                            game_id,
                            actor_user_id,
                            sequence_no,
                            action_type,
                            question_text,
                            answer,
                            answer_comment,
                            guessed_pokemon_id,
                            correct,
                            created_at,
                            answered_at
                        )
                        VALUES (
                            :id,
                            :commandId,
                            :gameId,
                            :actorUserId,
                            :sequenceNumber,
                            'QUESTION',
                            :question,
                            :answer,
                            :comment,
                            NULL,
                            NULL,
                            :createdAt,
                            :answeredAt
                        )
                        """)
                .param(
                        "id",
                        id(gameId + "-action-" + sequenceNumber))
                .param(
                        "commandId",
                        id(gameId + "-command-" + sequenceNumber))
                .param("gameId", gameId)
                .param("actorUserId", questionerUserId)
                .param("sequenceNumber", sequenceNumber)
                .param("question", question)
                .param("answer", answer.name())
                .param("comment", comment)
                .param("createdAt", timestamp(createdAt))
                .param("answeredAt", timestamp(answeredAt))
                .update();
    }

    void insertPendingQuestion(
            UUID gameId,
            UUID questionerUserId,
            int sequenceNumber,
            String question,
            Instant createdAt) {
        jdbcClient
                .sql(
                        """
                        INSERT INTO game_action (
                            id,
                            command_id,
                            game_id,
                            actor_user_id,
                            sequence_no,
                            action_type,
                            question_text,
                            answer,
                            guessed_pokemon_id,
                            correct,
                            created_at,
                            answered_at
                        )
                        VALUES (
                            :id,
                            :commandId,
                            :gameId,
                            :actorUserId,
                            :sequenceNumber,
                            'QUESTION',
                            :question,
                            NULL,
                            NULL,
                            NULL,
                            :createdAt,
                            NULL
                        )
                        """)
                .param(
                        "id",
                        id(gameId + "-action-" + sequenceNumber))
                .param(
                        "commandId",
                        id(gameId + "-command-" + sequenceNumber))
                .param("gameId", gameId)
                .param("actorUserId", questionerUserId)
                .param("sequenceNumber", sequenceNumber)
                .param("question", question)
                .param("createdAt", timestamp(createdAt))
                .update();
    }

    void insertGuess(
            UUID gameId,
            UUID questionerUserId,
            int sequenceNumber,
            int nationalDexId,
            boolean correct,
            Instant createdAt) {
        jdbcClient
                .sql(
                        """
                        INSERT INTO game_action (
                            id,
                            command_id,
                            game_id,
                            actor_user_id,
                            sequence_no,
                            action_type,
                            question_text,
                            answer,
                            guessed_pokemon_id,
                            correct,
                            created_at,
                            answered_at
                        )
                        VALUES (
                            :id,
                            :commandId,
                            :gameId,
                            :actorUserId,
                            :sequenceNumber,
                            'GUESS',
                            NULL,
                            NULL,
                            :nationalDexId,
                            :correct,
                            :createdAt,
                            NULL
                        )
                        """)
                .param(
                        "id",
                        id(gameId + "-action-" + sequenceNumber))
                .param(
                        "commandId",
                        id(gameId + "-command-" + sequenceNumber))
                .param("gameId", gameId)
                .param("actorUserId", questionerUserId)
                .param("sequenceNumber", sequenceNumber)
                .param("nationalDexId", nationalDexId)
                .param("correct", correct)
                .param("createdAt", timestamp(createdAt))
                .update();
    }

    void disableAnswerPokemon() {
        jdbcClient
                .sql(
                        """
                        UPDATE pokemon_species
                        SET enabled = FALSE
                        WHERE national_dex_id = :nationalDexId
                        """)
                .param(
                        "nationalDexId",
                        ANSWER_POKEMON_ID)
                .update();
    }

    static UUID id(String value) {
        return UUID.nameUUIDFromBytes(
                value.getBytes(
                        java.nio.charset.StandardCharsets.UTF_8));
    }

    private static Timestamp timestamp(Instant instant) {
        return Timestamp.from(instant);
    }

    private void insertParticipants(
            UUID gameId,
            UUID selectorUserId,
            UUID questionerUserId,
            GameResult selectorResult,
            GameResult questionerResult,
            Instant createdAt) {
        insertParticipant(
                gameId,
                selectorUserId,
                "SELECTOR",
                selectorResult,
                createdAt);
        insertParticipant(
                gameId,
                questionerUserId,
                "QUESTIONER",
                questionerResult,
                createdAt);
    }

    private void insertParticipant(
            UUID gameId,
            UUID userId,
            String role,
            GameResult result,
            Instant createdAt) {
        jdbcClient
                .sql(
                        """
                        INSERT INTO game_participant (
                            game_id,
                            user_id,
                            role,
                            result,
                            created_at
                        )
                        VALUES (
                            :gameId,
                            :userId,
                            :role,
                            :result,
                            :createdAt
                        )
                        """)
                .param("gameId", gameId)
                .param("userId", userId)
                .param("role", role)
                .param("result", result.name())
                .param("createdAt", timestamp(createdAt))
                .update();
    }
}

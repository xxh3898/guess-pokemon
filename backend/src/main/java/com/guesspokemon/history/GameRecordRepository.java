package com.guesspokemon.history;

import com.guesspokemon.game.GameTypes.GameStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GameRecordRepository
        extends JpaRepository<GameRecord, UUID> {

    List<GameRecord> findAllByStatus(GameStatus status);

    @Query(
            value =
                    """
                    SELECT
                        game.id AS game_id,
                        game.mode AS mode,
                        game.started_at AS started_at,
                        game.ended_at AS ended_at,
                        me.role AS my_role,
                        me.result AS my_result,
                        opponent.user_id AS opponent_id,
                        opponent_user.nickname AS opponent_nickname,
                        answer_species.national_dex_id
                            AS answer_national_dex_id,
                        answer_species.korean_name
                            AS answer_korean_name,
                        answer_species.generation
                            AS answer_generation,
                        answer_species.primary_type
                            AS answer_primary_type,
                        answer_species.secondary_type
                            AS answer_secondary_type,
                        answer_species.artwork_url
                            AS answer_artwork_url,
                        answer_species.enabled
                            AS answer_catalog_enabled,
                        game.end_reason AS end_reason,
                        game.action_count AS action_count
                    FROM game
                    JOIN game_participant me
                      ON me.game_id = game.id
                     AND me.user_id = :userId
                    JOIN game_participant opponent
                      ON opponent.game_id = game.id
                     AND opponent.user_id <> :userId
                    JOIN app_user opponent_user
                      ON opponent_user.id = opponent.user_id
                    JOIN pokemon_species answer_species
                      ON answer_species.national_dex_id =
                            game.answer_pokemon_id
                    WHERE game.ended_at IS NOT NULL
                      AND (
                            CAST(:result AS VARCHAR) IS NULL
                            OR me.result = CAST(:result AS VARCHAR)
                      )
                    ORDER BY game.ended_at DESC, game.id DESC
                    """,
            countQuery =
                    """
                    SELECT COUNT(*)
                    FROM game
                    JOIN game_participant me
                      ON me.game_id = game.id
                     AND me.user_id = :userId
                    WHERE game.ended_at IS NOT NULL
                      AND (
                            CAST(:result AS VARCHAR) IS NULL
                            OR me.result = CAST(:result AS VARCHAR)
                      )
                    """,
            nativeQuery = true)
    Page<GameListRow> findHistoryPage(
            @Param("userId") UUID userId,
            @Param("result") String result,
            Pageable pageable);

    @Query(
            value =
                    """
                    SELECT
                        game.id AS game_id,
                        game.mode AS mode,
                        game.status AS status,
                        game.started_at AS started_at,
                        game.ended_at AS ended_at,
                        answer_species.national_dex_id
                            AS answer_national_dex_id,
                        answer_species.korean_name
                            AS answer_korean_name,
                        answer_species.generation
                            AS answer_generation,
                        answer_species.primary_type
                            AS answer_primary_type,
                        answer_species.secondary_type
                            AS answer_secondary_type,
                        answer_species.artwork_url
                            AS answer_artwork_url,
                        answer_species.enabled
                            AS answer_catalog_enabled,
                        game.end_reason AS end_reason,
                        game.action_count AS action_count
                    FROM game
                    JOIN pokemon_species answer_species
                      ON answer_species.national_dex_id =
                            game.answer_pokemon_id
                    WHERE game.id = :gameId
                      AND game.ended_at IS NOT NULL
                      AND EXISTS (
                            SELECT 1
                            FROM game_participant participant
                            WHERE participant.game_id = game.id
                              AND participant.user_id = :userId
                      )
                    """,
            nativeQuery = true)
    Optional<GameDetailRow> findHistoryDetail(
            @Param("gameId") UUID gameId,
            @Param("userId") UUID userId);

    interface GameListRow {

        UUID getGameId();

        String getMode();

        Instant getStartedAt();

        Instant getEndedAt();

        String getMyRole();

        String getMyResult();

        UUID getOpponentId();

        String getOpponentNickname();

        Integer getAnswerNationalDexId();

        String getAnswerKoreanName();

        Short getAnswerGeneration();

        String getAnswerPrimaryType();

        String getAnswerSecondaryType();

        String getAnswerArtworkUrl();

        Boolean getAnswerCatalogEnabled();

        String getEndReason();

        Short getActionCount();
    }

    interface GameDetailRow {

        UUID getGameId();

        String getMode();

        String getStatus();

        Instant getStartedAt();

        Instant getEndedAt();

        Integer getAnswerNationalDexId();

        String getAnswerKoreanName();

        Short getAnswerGeneration();

        String getAnswerPrimaryType();

        String getAnswerSecondaryType();

        String getAnswerArtworkUrl();

        Boolean getAnswerCatalogEnabled();

        String getEndReason();

        Short getActionCount();
    }
}

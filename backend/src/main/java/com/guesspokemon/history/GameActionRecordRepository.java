package com.guesspokemon.history;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GameActionRecordRepository
        extends JpaRepository<GameActionRecord, UUID> {

    Optional<GameActionRecord>
            findByGameIdAndSequenceNumber(
                    UUID gameId,
                    Short sequenceNumber);

    boolean existsByCommandId(UUID commandId);

    @Query(
            value =
                    """
                    SELECT
                        action.sequence_no AS sequence_no,
                        action.action_type AS type,
                        action.question_text AS question,
                        action.answer AS answer,
                        guessed_species.national_dex_id
                            AS guessed_national_dex_id,
                        guessed_species.korean_name
                            AS guessed_korean_name,
                        guessed_species.generation
                            AS guessed_generation,
                        guessed_species.artwork_url
                            AS guessed_artwork_url,
                        guessed_species.enabled
                            AS guessed_catalog_enabled,
                        action.correct AS correct,
                        action.created_at AS created_at,
                        action.answered_at AS answered_at
                    FROM game_action action
                    LEFT JOIN pokemon_species guessed_species
                      ON guessed_species.national_dex_id =
                            action.guessed_pokemon_id
                    WHERE action.game_id = :gameId
                    ORDER BY action.sequence_no
                    """,
            nativeQuery = true)
    List<GameActionRow> findHistoryActions(
            @Param("gameId") UUID gameId);

    interface GameActionRow {

        Short getSequenceNo();

        String getType();

        String getQuestion();

        String getAnswer();

        Integer getGuessedNationalDexId();

        String getGuessedKoreanName();

        Short getGuessedGeneration();

        String getGuessedArtworkUrl();

        Boolean getGuessedCatalogEnabled();

        Boolean getCorrect();

        Instant getCreatedAt();

        Instant getAnsweredAt();
    }
}

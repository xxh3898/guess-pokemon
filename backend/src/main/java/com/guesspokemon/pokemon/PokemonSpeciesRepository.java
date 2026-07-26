package com.guesspokemon.pokemon;

import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PokemonSpeciesRepository
        extends JpaRepository<PokemonSpecies, Integer> {

    @Query(
            """
            SELECT species
            FROM PokemonSpecies species
            WHERE species.enabled = true
              AND (:generation IS NULL OR species.generation = :generation)
              AND (
                    :query = ''
                    OR (
                        :nationalDexId IS NOT NULL
                        AND species.nationalDexId = :nationalDexId
                    )
                    OR (
                        :nationalDexId IS NULL
                        AND species.koreanName LIKE CONCAT('%', :query, '%')
                    )
              )
            """)
    Page<PokemonSpecies> search(
            @Param("query") String query,
            @Param("nationalDexId") Integer nationalDexId,
            @Param("generation") Short generation,
            Pageable pageable);

    Optional<PokemonSpecies> findByNationalDexIdAndEnabledTrue(
            Integer nationalDexId);

    List<PokemonSpecies>
            findAllByEvolvesFromNationalDexIdAndEnabledTrueOrderByNationalDexIdAsc(
                    Integer evolvesFromNationalDexId);
}

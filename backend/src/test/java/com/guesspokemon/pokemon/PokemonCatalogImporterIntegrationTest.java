package com.guesspokemon.pokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class PokemonCatalogImporterIntegrationTest {

    @Autowired
    private PokemonCatalogImporter pokemonCatalogImporter;

    @Autowired
    private JdbcClient jdbcClient;

    @BeforeEach
    void restoreCatalog() {
        pokemonCatalogImporter.run(null);
        enablePikachu();
        deleteOutdatedFixture();
    }

    @AfterEach
    void cleanUp() {
        pokemonCatalogImporter.run(null);
        enablePikachu();
        deleteOutdatedFixture();
    }

    private void enablePikachu() {
        jdbcClient
                .sql(
                        """
                        UPDATE pokemon_species
                        SET enabled = TRUE
                        WHERE national_dex_id = 25
                        """)
                .update();
    }

    private void deleteOutdatedFixture() {
        jdbcClient
                .sql(
                        """
                        DELETE FROM pokemon_species
                        WHERE national_dex_id = 2000
                        """)
                .update();
    }

    @Test
    void should_importCompleteCatalog_when_applicationStarts() {
        Long rowCount =
                jdbcClient
                        .sql("SELECT COUNT(*) FROM pokemon_species")
                        .query(Long.class)
                        .single();
        Long versionCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(DISTINCT catalog_version)
                                FROM pokemon_species
                                """)
                        .query(Long.class)
                        .single();
        Long typedRowCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM pokemon_species
                                WHERE enabled = TRUE
                                  AND primary_type IS NOT NULL
                                """)
                        .query(Long.class)
                        .single();
        Integer pikachuParent =
                jdbcClient
                        .sql(
                                """
                                SELECT evolves_from_national_dex_id
                                FROM pokemon_species
                                WHERE national_dex_id = 25
                                """)
                        .query(Integer.class)
                        .single();
        Integer raichuParent =
                jdbcClient
                        .sql(
                                """
                                SELECT evolves_from_national_dex_id
                                FROM pokemon_species
                                WHERE national_dex_id = 26
                                """)
                        .query(Integer.class)
                        .single();

        assertEquals(1025L, rowCount);
        assertEquals(1L, versionCount);
        assertEquals(1025L, typedRowCount);
        assertEquals(172, pikachuParent);
        assertEquals(25, raichuParent);
    }

    @Test
    void should_preserveDisabledRow_when_sameVersionIsAlreadyImported() {
        jdbcClient
                .sql(
                        """
                        UPDATE pokemon_species
                        SET enabled = FALSE
                        WHERE national_dex_id = 25
                        """)
                .update();

        pokemonCatalogImporter.run(null);

        Boolean enabled =
                jdbcClient
                        .sql(
                                """
                                SELECT enabled
                                FROM pokemon_species
                                WHERE national_dex_id = 25
                                """)
                        .query(Boolean.class)
                        .single();
        assertFalse(enabled);
    }

    @Test
    void should_restoreEvolutionRelationAndPreserveDisabledRow_when_sameVersionRelationIsMissing() {
        jdbcClient
                .sql(
                        """
                        UPDATE pokemon_species
                        SET enabled = FALSE,
                            evolves_from_national_dex_id = NULL
                        WHERE national_dex_id = 25
                        """)
                .update();

        pokemonCatalogImporter.run(null);

        Boolean enabled =
                jdbcClient
                        .sql(
                                """
                                SELECT enabled
                                FROM pokemon_species
                                WHERE national_dex_id = 25
                                """)
                        .query(Boolean.class)
                        .single();
        Integer evolvesFromNationalDexId =
                jdbcClient
                        .sql(
                                """
                                SELECT evolves_from_national_dex_id
                                FROM pokemon_species
                                WHERE national_dex_id = 25
                                """)
                        .query(Integer.class)
                        .single();

        assertFalse(enabled);
        assertEquals(172, evolvesFromNationalDexId);
    }

    @Test
    void should_restoreMissingRow_when_currentVersionIsIncomplete() {
        jdbcClient
                .sql(
                        """
                        DELETE FROM pokemon_species
                        WHERE national_dex_id = 1025
                        """)
                .update();

        pokemonCatalogImporter.run(null);

        Long rowCount =
                jdbcClient
                        .sql("SELECT COUNT(*) FROM pokemon_species")
                        .query(Long.class)
                        .single();
        assertEquals(1025L, rowCount);
    }

    @Test
    void should_restoreTypeDataAndEnableRow_when_currentVersionIsIncomplete() {
        jdbcClient
                .sql(
                        """
                        UPDATE pokemon_species
                        SET enabled = FALSE,
                            primary_type = NULL,
                            secondary_type = NULL
                        WHERE national_dex_id = 25
                        """)
                .update();

        pokemonCatalogImporter.run(null);

        Boolean enabled =
                jdbcClient
                        .sql(
                                """
                                SELECT enabled
                                FROM pokemon_species
                                WHERE national_dex_id = 25
                                """)
                        .query(Boolean.class)
                        .single();
        String primaryType =
                jdbcClient
                        .sql(
                                """
                                SELECT primary_type
                                FROM pokemon_species
                                WHERE national_dex_id = 25
                                """)
                        .query(String.class)
                        .single();
        assertTrue(enabled);
        assertEquals("ELECTRIC", primaryType);
    }

    @Test
    void should_disableOutdatedRow_when_currentVersionIsComplete() {
        jdbcClient
                .sql(
                        """
                        INSERT INTO pokemon_species (
                            national_dex_id,
                            slug,
                            korean_name,
                            generation,
                            primary_type,
                            secondary_type,
                            artwork_url,
                            catalog_version,
                            source_updated_at,
                            enabled
                        )
                        VALUES (
                            2000,
                            'outdated-species',
                            '이전도감',
                            9,
                            'NORMAL',
                            NULL,
                            'https://example.com/2000.png',
                            'pokeapi-v2-outdated',
                            CURRENT_TIMESTAMP,
                            TRUE
                        )
                        """)
                .update();

        pokemonCatalogImporter.run(null);

        Boolean enabled =
                jdbcClient
                        .sql(
                                """
                                SELECT enabled
                                FROM pokemon_species
                                WHERE national_dex_id = 2000
                                """)
                        .query(Boolean.class)
                        .single();
        assertFalse(enabled);
    }
}

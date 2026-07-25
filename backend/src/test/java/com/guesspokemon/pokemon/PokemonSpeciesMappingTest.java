package com.guesspokemon.pokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class PokemonSpeciesMappingTest {

    @Autowired
    private PokemonSpeciesRepository pokemonSpeciesRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void should_mapCatalogRow_when_speciesIsLoaded() {
        PokemonSpecies pikachu =
                pokemonSpeciesRepository.findById(25).orElseThrow();

        assertEquals("pikachu", pikachu.getSlug());
        assertEquals("피카츄", pikachu.getKoreanName());
        assertEquals((short) 1, pikachu.getGeneration());
        assertEquals(
                List.of(PokemonType.ELECTRIC),
                pikachu.getTypes());
        assertTrue(pikachu.getArtworkUrl().startsWith("https://"));
        assertTrue(pikachu.getCatalogVersion().startsWith("pokeapi-v2-"));
        assertTrue(pikachu.isEnabled());
    }

    @Test
    @Transactional
    void should_rejectRow_when_generationIsOutsideConstraint() {
        assertThrows(
                DataIntegrityViolationException.class,
                () ->
                        jdbcTemplate.update(
                                """
                                INSERT INTO pokemon_species (
                                    national_dex_id,
                                    slug,
                                    korean_name,
                                    generation,
                                    primary_type,
                                    artwork_url,
                                    catalog_version,
                                    source_updated_at,
                                    enabled
                                )
                                VALUES (
                                    2000,
                                    'invalid-generation',
                                    '잘못된세대',
                                    10,
                                    'NORMAL',
                                    'https://example.com/2000.png',
                                    'test-invalid',
                                    CURRENT_TIMESTAMP,
                                    TRUE
                                )
                                """));
    }

    @Test
    @Transactional
    void should_rejectRow_when_typesAreDuplicated() {
        assertThrows(
                DataIntegrityViolationException.class,
                () ->
                        jdbcTemplate.update(
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
                                    2001,
                                    'invalid-types',
                                    '잘못된타입',
                                    9,
                                    'ELECTRIC',
                                    'ELECTRIC',
                                    'https://example.com/2001.png',
                                    'test-invalid',
                                    CURRENT_TIMESTAMP,
                                    TRUE
                                )
                                """));
    }
}

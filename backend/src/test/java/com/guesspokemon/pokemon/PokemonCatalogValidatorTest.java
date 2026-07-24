package com.guesspokemon.pokemon;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class PokemonCatalogValidatorTest {

    private PokemonCatalogValidator pokemonCatalogValidator;

    @BeforeEach
    void setUp() {
        JsonMapper jsonMapper =
                JsonMapper.builder().findAndAddModules().build();
        pokemonCatalogValidator =
                new PokemonCatalogValidator(jsonMapper);
    }

    @Test
    void should_acceptSnapshot_when_allInvariantsAreValid() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        PokemonCatalogSnapshot snapshot = createSnapshot(species);

        assertDoesNotThrow(
                () -> pokemonCatalogValidator.validate(snapshot));
    }

    @Test
    void should_rejectSnapshot_when_nationalDexIdIsMissing() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        species.set(
                24,
                new PokemonCatalogSnapshot.Species(
                        26,
                        "duplicate-id",
                        "누락검증",
                        1,
                        artworkUrl(26)));
        PokemonCatalogSnapshot snapshot =
                new PokemonCatalogSnapshot(
                        "pokeapi-v2-invalid",
                        PokemonCatalogValidator.EXPECTED_SOURCE,
                        Instant.parse("2026-07-25T00:00:00Z"),
                        PokemonCatalogValidator.EXPECTED_NATIONAL_DEX_MAX,
                        species);

        assertThrows(
                IllegalStateException.class,
                () -> pokemonCatalogValidator.validate(snapshot));
    }

    @Test
    void should_rejectSnapshot_when_koreanNameIsDuplicated() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        PokemonCatalogSnapshot.Species first = species.get(0);
        PokemonCatalogSnapshot.Species second = species.get(1);
        species.set(
                1,
                new PokemonCatalogSnapshot.Species(
                        second.nationalDexId(),
                        second.slug(),
                        first.koreanName(),
                        second.generation(),
                        second.artworkUrl()));
        PokemonCatalogSnapshot snapshot =
                new PokemonCatalogSnapshot(
                        "pokeapi-v2-invalid",
                        PokemonCatalogValidator.EXPECTED_SOURCE,
                        Instant.parse("2026-07-25T00:00:00Z"),
                        PokemonCatalogValidator.EXPECTED_NATIONAL_DEX_MAX,
                        species);

        assertThrows(
                IllegalStateException.class,
                () -> pokemonCatalogValidator.validate(snapshot));
    }

    @Test
    void should_rejectSnapshot_when_catalogVersionDoesNotMatchContent() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        PokemonCatalogSnapshot snapshot =
                new PokemonCatalogSnapshot(
                        "pokeapi-v2-00000000000000000000",
                        PokemonCatalogValidator.EXPECTED_SOURCE,
                        Instant.parse("2026-07-25T00:00:00Z"),
                        PokemonCatalogValidator.EXPECTED_NATIONAL_DEX_MAX,
                        species);

        assertThrows(
                IllegalStateException.class,
                () -> pokemonCatalogValidator.validate(snapshot));
    }

    private PokemonCatalogSnapshot createSnapshot(
            List<PokemonCatalogSnapshot.Species> species) {
        return new PokemonCatalogSnapshot(
                pokemonCatalogValidator.expectedCatalogVersion(species),
                PokemonCatalogValidator.EXPECTED_SOURCE,
                Instant.parse("2026-07-25T00:00:00Z"),
                PokemonCatalogValidator.EXPECTED_NATIONAL_DEX_MAX,
                species);
    }

    private List<PokemonCatalogSnapshot.Species> createCompleteSpecies() {
        List<PokemonCatalogSnapshot.Species> species =
                new ArrayList<>(
                        PokemonCatalogValidator.EXPECTED_NATIONAL_DEX_MAX);
        for (int nationalDexId = 1;
                nationalDexId
                        <= PokemonCatalogValidator
                                .EXPECTED_NATIONAL_DEX_MAX;
                nationalDexId++) {
            species.add(
                    new PokemonCatalogSnapshot.Species(
                            nationalDexId,
                            "pokemon-" + nationalDexId,
                            "포켓몬-" + nationalDexId,
                            Math.min(((nationalDexId - 1) / 130) + 1, 9),
                            artworkUrl(nationalDexId)));
        }
        return species;
    }

    private String artworkUrl(int nationalDexId) {
        return "https://raw.githubusercontent.com/PokeAPI/sprites/master/"
                + "sprites/pokemon/other/official-artwork/"
                + nationalDexId
                + ".png";
    }
}

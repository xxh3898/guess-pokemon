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
                        null,
                        artworkUrl(26),
                        List.of(PokemonType.NORMAL)));
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
                        second.evolvesFromNationalDexId(),
                        second.artworkUrl(),
                        second.types()));
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

    @Test
    void should_rejectSnapshot_when_typeCountIsInvalid() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        PokemonCatalogSnapshot.Species first = species.getFirst();
        species.set(
                0,
                new PokemonCatalogSnapshot.Species(
                        first.nationalDexId(),
                        first.slug(),
                        first.koreanName(),
                        first.generation(),
                        first.evolvesFromNationalDexId(),
                        first.artworkUrl(),
                        List.of()));
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
    void should_rejectSnapshot_when_typeIsDuplicated() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        PokemonCatalogSnapshot.Species first = species.getFirst();
        species.set(
                0,
                new PokemonCatalogSnapshot.Species(
                        first.nationalDexId(),
                        first.slug(),
                        first.koreanName(),
                        first.generation(),
                        first.evolvesFromNationalDexId(),
                        first.artworkUrl(),
                        List.of(
                                PokemonType.NORMAL,
                                PokemonType.NORMAL)));
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
    void should_acceptSnapshot_when_parentNationalDexIdIsGreater() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        PokemonCatalogSnapshot.Species pikachu = species.get(24);
        species.set(
                24,
                withEvolutionParent(pikachu, 172));
        PokemonCatalogSnapshot snapshot = createSnapshot(species);

        assertDoesNotThrow(
                () -> pokemonCatalogValidator.validate(snapshot));
    }

    @Test
    void should_rejectSnapshot_when_evolutionParentIsMissing() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        PokemonCatalogSnapshot.Species pikachu = species.get(24);
        species.set(
                24,
                withEvolutionParent(
                        pikachu,
                        PokemonCatalogValidator.EXPECTED_NATIONAL_DEX_MAX
                                + 1));
        PokemonCatalogSnapshot snapshot = createSnapshot(species);

        assertThrows(
                IllegalStateException.class,
                () -> pokemonCatalogValidator.validate(snapshot));
    }

    @Test
    void should_rejectSnapshot_when_evolutionReferencesSelf() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        PokemonCatalogSnapshot.Species pikachu = species.get(24);
        species.set(
                24,
                withEvolutionParent(pikachu, 25));
        PokemonCatalogSnapshot snapshot = createSnapshot(species);

        assertThrows(
                IllegalStateException.class,
                () -> pokemonCatalogValidator.validate(snapshot));
    }

    @Test
    void should_rejectSnapshot_when_evolutionRelationsContainCycle() {
        List<PokemonCatalogSnapshot.Species> species =
                createCompleteSpecies();
        species.set(
                0,
                withEvolutionParent(species.get(0), 2));
        species.set(
                1,
                withEvolutionParent(species.get(1), 1));
        PokemonCatalogSnapshot snapshot = createSnapshot(species);

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
                            null,
                            artworkUrl(nationalDexId),
                            List.of(PokemonType.NORMAL)));
        }
        return species;
    }

    private PokemonCatalogSnapshot.Species withEvolutionParent(
            PokemonCatalogSnapshot.Species species,
            Integer evolvesFromNationalDexId) {
        return new PokemonCatalogSnapshot.Species(
                species.nationalDexId(),
                species.slug(),
                species.koreanName(),
                species.generation(),
                evolvesFromNationalDexId,
                species.artworkUrl(),
                species.types());
    }

    private String artworkUrl(int nationalDexId) {
        return "https://raw.githubusercontent.com/PokeAPI/sprites/master/"
                + "sprites/pokemon/other/official-artwork/"
                + nationalDexId
                + ".png";
    }
}

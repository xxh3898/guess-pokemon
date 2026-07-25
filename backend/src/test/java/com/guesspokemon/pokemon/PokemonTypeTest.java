package com.guesspokemon.pokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class PokemonTypeTest {

    @Test
    void should_containSupportedCodes_when_enumIsRead() {
        Set<PokemonType> expected =
                Set.of(
                        PokemonType.BUG,
                        PokemonType.DARK,
                        PokemonType.DRAGON,
                        PokemonType.ELECTRIC,
                        PokemonType.FAIRY,
                        PokemonType.FIGHTING,
                        PokemonType.FIRE,
                        PokemonType.FLYING,
                        PokemonType.GHOST,
                        PokemonType.GRASS,
                        PokemonType.GROUND,
                        PokemonType.ICE,
                        PokemonType.NORMAL,
                        PokemonType.POISON,
                        PokemonType.PSYCHIC,
                        PokemonType.ROCK,
                        PokemonType.STEEL,
                        PokemonType.WATER);

        assertEquals(
                expected,
                EnumSet.allOf(PokemonType.class));
    }
}

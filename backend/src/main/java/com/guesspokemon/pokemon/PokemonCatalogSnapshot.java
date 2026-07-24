package com.guesspokemon.pokemon;

import java.time.Instant;
import java.util.List;

public record PokemonCatalogSnapshot(
        String catalogVersion,
        String source,
        Instant sourceUpdatedAt,
        int expectedNationalDexMax,
        List<Species> species) {

    public record Species(
            int nationalDexId,
            String slug,
            String koreanName,
            int generation,
            String artworkUrl) {
    }
}

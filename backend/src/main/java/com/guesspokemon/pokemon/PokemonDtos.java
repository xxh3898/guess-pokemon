package com.guesspokemon.pokemon;

import java.util.List;

public final class PokemonDtos {

    private PokemonDtos() {
    }

    public record PokemonSummary(
            int nationalDexId,
            String koreanName,
            int generation,
            String artworkUrl,
            boolean artworkEnabled,
            List<PokemonType> types) {
    }

    public record PokemonPage(
            List<PokemonSummary> content,
            int page,
            int size,
            long totalElements,
            int totalPages) {
    }
}

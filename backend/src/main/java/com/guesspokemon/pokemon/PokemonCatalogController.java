package com.guesspokemon.pokemon;

import com.guesspokemon.pokemon.PokemonDtos.PokemonEvolutionDetails;
import com.guesspokemon.pokemon.PokemonDtos.PokemonPage;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/pokemon-species")
public class PokemonCatalogController {

    private final PokemonCatalogService pokemonCatalogService;

    public PokemonCatalogController(
            PokemonCatalogService pokemonCatalogService) {
        this.pokemonCatalogService = pokemonCatalogService;
    }

    @GetMapping
    PokemonPage search(
            @RequestParam(defaultValue = "") String query,
            @RequestParam(required = false)
                    @Min(1)
                    @Max(9)
                    Integer generation,
            @RequestParam(defaultValue = "0")
                    @Min(0)
                    int page,
            @RequestParam(defaultValue = "20")
                    @Min(1)
                    @Max(100)
                    int size) {
        return pokemonCatalogService.search(
                query,
                generation,
                page,
                size);
    }

    @GetMapping("/{nationalDexId}")
    PokemonSummary findByNationalDexId(
            @PathVariable @Positive int nationalDexId) {
        return pokemonCatalogService.findByNationalDexId(nationalDexId);
    }

    @GetMapping("/{nationalDexId}/evolutions")
    PokemonEvolutionDetails findEvolutionDetails(
            @PathVariable @Positive int nationalDexId) {
        return pokemonCatalogService.findEvolutionDetails(nationalDexId);
    }
}

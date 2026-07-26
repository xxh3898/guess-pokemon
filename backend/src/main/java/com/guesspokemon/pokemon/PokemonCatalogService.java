package com.guesspokemon.pokemon;

import static com.guesspokemon.common.error.ApiErrorCode.POKEMON_NOT_FOUND;
import static com.guesspokemon.common.error.ApiErrorCode.VALIDATION_FAILED;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.pokemon.PokemonDtos.PokemonEvolutionDetails;
import com.guesspokemon.pokemon.PokemonDtos.PokemonPage;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import java.text.Normalizer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PokemonCatalogService {

    private static final int MAX_QUERY_LENGTH = 80;
    private static final Sort NATIONAL_DEX_SORT =
            Sort.by(Sort.Direction.ASC, "nationalDexId");

    private final PokemonSpeciesRepository pokemonSpeciesRepository;
    private final boolean artworkEnabled;

    public PokemonCatalogService(
            PokemonSpeciesRepository pokemonSpeciesRepository,
            @Value("${pokemon.catalog.artwork-enabled:true}")
                    boolean artworkEnabled) {
        this.pokemonSpeciesRepository = pokemonSpeciesRepository;
        this.artworkEnabled = artworkEnabled;
    }

    @Transactional(readOnly = true)
    public PokemonPage search(
            String queryInput,
            Integer generation,
            int page,
            int size) {
        String query = normalizeQuery(queryInput);
        Integer nationalDexId = parseNationalDexId(query);
        Short generationValue =
                generation == null ? null : generation.shortValue();
        Page<PokemonSpecies> result =
                pokemonSpeciesRepository.search(
                        query,
                        nationalDexId,
                        generationValue,
                        PageRequest.of(page, size, NATIONAL_DEX_SORT));
        return new PokemonPage(
                result.getContent().stream()
                        .map(this::toSummary)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public PokemonSummary findByNationalDexId(int nationalDexId) {
        return toSummary(findEnabledSpecies(nationalDexId));
    }

    @Transactional(readOnly = true)
    public PokemonEvolutionDetails findEvolutionDetails(
            int nationalDexId) {
        PokemonSpecies species = findEnabledSpecies(nationalDexId);
        PokemonSummary previousEvolution =
                species.getEvolvesFromNationalDexId() == null
                        ? null
                        : pokemonSpeciesRepository
                                .findByNationalDexIdAndEnabledTrue(
                                        species
                                                .getEvolvesFromNationalDexId())
                                .map(this::toSummary)
                                .orElse(null);
        return new PokemonEvolutionDetails(
                toSummary(species),
                previousEvolution,
                pokemonSpeciesRepository
                        .findAllByEvolvesFromNationalDexIdAndEnabledTrueOrderByNationalDexIdAsc(
                                nationalDexId)
                        .stream()
                        .map(this::toSummary)
                        .toList());
    }

    private PokemonSpecies findEnabledSpecies(int nationalDexId) {
        PokemonSpecies species =
                pokemonSpeciesRepository
                        .findByNationalDexIdAndEnabledTrue(nationalDexId)
                        .orElseThrow(() -> new ApiException(POKEMON_NOT_FOUND));
        return species;
    }

    private String normalizeQuery(String queryInput) {
        if (queryInput == null || queryInput.isBlank()) {
            return "";
        }
        String normalized =
                Normalizer.normalize(
                        queryInput.strip(),
                        Normalizer.Form.NFC);
        if (normalized.length() > MAX_QUERY_LENGTH) {
            throw new ApiException(VALIDATION_FAILED);
        }
        return normalized;
    }

    private Integer parseNationalDexId(String query) {
        if (query.isEmpty()
                || !query.chars().allMatch(Character::isDigit)) {
            return null;
        }
        try {
            return Integer.valueOf(query);
        } catch (NumberFormatException exception) {
            return -1;
        }
    }

    private PokemonSummary toSummary(PokemonSpecies species) {
        return new PokemonSummary(
                species.getNationalDexId(),
                species.getKoreanName(),
                species.getGeneration(),
                artworkEnabled ? species.getArtworkUrl() : null,
                artworkEnabled,
                species.getTypes());
    }
}

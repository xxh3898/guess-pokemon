package com.guesspokemon.pokemon;

import java.net.URI;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

@Component
public class PokemonCatalogValidator {

    static final int EXPECTED_NATIONAL_DEX_MAX = 1025;
    static final String EXPECTED_SOURCE = "https://pokeapi.co/api/v2/";
    private static final String CATALOG_VERSION_PREFIX = "pokeapi-v2-";
    private static final int CATALOG_VERSION_HASH_LENGTH = 20;
    private static final Pattern SLUG_PATTERN = Pattern.compile("^[a-z0-9-]+$");

    private final JsonMapper jsonMapper;

    public PokemonCatalogValidator(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    public void validate(PokemonCatalogSnapshot snapshot) {
        require(snapshot != null, "catalog snapshot이 없습니다.");
        require(
                EXPECTED_SOURCE.equals(snapshot.source()),
                "catalog source가 올바르지 않습니다.");
        require(
                snapshot.sourceUpdatedAt() != null,
                "catalog sourceUpdatedAt이 없습니다.");
        require(
                snapshot.expectedNationalDexMax()
                        == EXPECTED_NATIONAL_DEX_MAX,
                "catalog 최대 National Dex ID가 승인 범위와 다릅니다.");
        require(
                snapshot.species() != null
                        && snapshot.species().size()
                                == EXPECTED_NATIONAL_DEX_MAX,
                "catalog species 개수가 승인 범위와 다릅니다.");

        Set<String> slugs = new HashSet<>();
        Set<String> koreanNames = new HashSet<>();
        for (int index = 0; index < snapshot.species().size(); index++) {
            PokemonCatalogSnapshot.Species species =
                    snapshot.species().get(index);
            int expectedNationalDexId = index + 1;
            require(
                    species.nationalDexId() == expectedNationalDexId,
                    "National Dex ID가 연속적이지 않습니다.");
            require(
                    species.slug() != null
                            && SLUG_PATTERN.matcher(species.slug()).matches(),
                    "species slug 형식이 올바르지 않습니다.");
            require(
                    slugs.add(species.slug()),
                    "중복 species slug가 있습니다.");
            require(
                    species.koreanName() != null
                            && !species.koreanName().isBlank()
                            && Normalizer.isNormalized(
                                    species.koreanName(),
                                    Normalizer.Form.NFC),
                    "한국어 이름이 없거나 NFC가 아닙니다.");
            require(
                    koreanNames.add(species.koreanName()),
                    "중복 한국어 이름이 있습니다.");
            require(
                    species.generation() >= 1
                            && species.generation() <= 9,
                    "generation 범위가 올바르지 않습니다.");
            requireHttpsUrl(species.artworkUrl());
            requireTypes(species.types());
        }
        validateEvolutionRelations(snapshot.species());

        require(
                expectedCatalogVersion(snapshot.species())
                        .equals(snapshot.catalogVersion()),
                "catalog version이 species content hash와 다릅니다.");
    }

    String expectedCatalogVersion(
            List<PokemonCatalogSnapshot.Species> species) {
        try {
            byte[] canonicalJson = jsonMapper.writeValueAsBytes(species);
            byte[] contentHash =
                    MessageDigest.getInstance("SHA-256")
                            .digest(canonicalJson);
            String hash = HexFormat.of().formatHex(contentHash);
            return CATALOG_VERSION_PREFIX
                    + hash.substring(0, CATALOG_VERSION_HASH_LENGTH);
        } catch (JacksonException | NoSuchAlgorithmException exception) {
            throw new IllegalStateException(
                    "catalog version을 계산할 수 없습니다.",
                    exception);
        }
    }

    private void validateEvolutionRelations(
            List<PokemonCatalogSnapshot.Species> speciesList) {
        Map<Integer, PokemonCatalogSnapshot.Species> speciesById =
                new HashMap<>();
        for (PokemonCatalogSnapshot.Species species : speciesList) {
            speciesById.put(species.nationalDexId(), species);
        }

        for (PokemonCatalogSnapshot.Species species : speciesList) {
            Integer evolvesFromNationalDexId =
                    species.evolvesFromNationalDexId();
            if (evolvesFromNationalDexId == null) {
                continue;
            }
            require(
                    evolvesFromNationalDexId
                            != species.nationalDexId(),
                    "이전 진화 종이 자기 자신입니다.");
            require(
                    speciesById.containsKey(evolvesFromNationalDexId),
                    "참조한 이전 진화 종이 catalog에 없습니다.");
        }

        for (PokemonCatalogSnapshot.Species species : speciesList) {
            Set<Integer> path = new HashSet<>();
            Integer currentNationalDexId = species.nationalDexId();
            while (currentNationalDexId != null) {
                require(
                        path.add(currentNationalDexId),
                        "진화 관계에 cycle이 있습니다.");
                currentNationalDexId =
                        speciesById
                                .get(currentNationalDexId)
                                .evolvesFromNationalDexId();
            }
        }
    }

    private void requireTypes(List<PokemonType> types) {
        require(
                types != null
                        && (types.size() == 1 || types.size() == 2),
                "포켓몬 타입은 1개 또는 2개여야 합니다.");
        require(
                types.stream().allMatch(Objects::nonNull),
                "포켓몬 타입에 null이 있습니다.");
        require(
                new HashSet<>(types).size() == types.size(),
                "중복 포켓몬 타입이 있습니다.");
    }

    private void requireHttpsUrl(String artworkUrl) {
        require(
                artworkUrl != null && !artworkUrl.isBlank(),
                "official artwork URL이 없습니다.");
        URI uri;
        try {
            uri = URI.create(artworkUrl);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "official artwork URL 형식이 올바르지 않습니다.",
                    exception);
        }
        require(
                "https".equalsIgnoreCase(uri.getScheme()),
                "official artwork URL은 HTTPS여야 합니다.");
        require(
                uri.getHost() != null,
                "official artwork URL host가 없습니다.");
    }

    private void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalStateException(message);
        }
    }
}

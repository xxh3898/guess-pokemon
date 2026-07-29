package com.guesspokemon.pokemon;

import static com.guesspokemon.common.error.ApiErrorCode.SILHOUETTE_UNAVAILABLE;

import com.guesspokemon.common.error.ApiException;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.imageio.ImageIO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class PokemonSilhouetteService {

    private static final String ARTWORK_HOST =
            "raw.githubusercontent.com";
    private static final int MAX_SOURCE_BYTES = 5 * 1024 * 1024;
    private static final int MAX_DIMENSION = 2_048;
    private static final int MAX_CACHE_ENTRIES = 128;

    private final PokemonSpeciesRepository pokemonSpeciesRepository;
    private final HttpClient httpClient;
    private final boolean artworkEnabled;
    private final Map<Integer, byte[]> cache =
            new LinkedHashMap<>(MAX_CACHE_ENTRIES, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(
                        Map.Entry<Integer, byte[]> eldest) {
                    return size() > MAX_CACHE_ENTRIES;
                }
            };

    public PokemonSilhouetteService(
            PokemonSpeciesRepository pokemonSpeciesRepository,
            @Value("${pokemon.catalog.artwork-enabled:true}")
                    boolean artworkEnabled) {
        this.pokemonSpeciesRepository = pokemonSpeciesRepository;
        this.artworkEnabled = artworkEnabled;
        this.httpClient =
                HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(3))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build();
    }

    public byte[] getSilhouette(int nationalDexId) {
        if (!artworkEnabled) {
            throw unavailable();
        }
        synchronized (cache) {
            byte[] cached = cache.get(nationalDexId);
            if (cached != null) {
                return cached.clone();
            }
        }
        PokemonSpecies species =
                pokemonSpeciesRepository
                        .findByNationalDexIdAndEnabledTrue(nationalDexId)
                        .orElseThrow(this::unavailable);
        byte[] silhouette =
                createSilhouette(download(species.getArtworkUrl()));
        synchronized (cache) {
            cache.put(nationalDexId, silhouette);
        }
        return silhouette.clone();
    }

    private byte[] download(String artworkUrl) {
        try {
            URI uri = URI.create(artworkUrl);
            if (!"https".equalsIgnoreCase(uri.getScheme())
                    || !ARTWORK_HOST.equalsIgnoreCase(uri.getHost())) {
                throw unavailable();
            }
            HttpRequest request =
                    HttpRequest.newBuilder(uri)
                            .timeout(Duration.ofSeconds(5))
                            .header("Accept", "image/png")
                            .GET()
                            .build();
            HttpResponse<byte[]> response =
                    httpClient.send(
                            request,
                            HttpResponse.BodyHandlers.ofByteArray());
            String contentType =
                    response.headers()
                            .firstValue("Content-Type")
                            .orElse("");
            if (response.statusCode() != 200
                    || !contentType
                            .toLowerCase(java.util.Locale.ROOT)
                            .startsWith("image/")
                    || response.body().length == 0
                    || response.body().length > MAX_SOURCE_BYTES) {
                throw unavailable();
            }
            return response.body();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            throw unavailable();
        }
    }

    static byte[] createSilhouette(byte[] source) {
        try {
            BufferedImage input =
                    ImageIO.read(new ByteArrayInputStream(source));
            if (input == null
                    || input.getWidth() < 1
                    || input.getHeight() < 1
                    || input.getWidth() > MAX_DIMENSION
                    || input.getHeight() > MAX_DIMENSION) {
                throw unavailableError();
            }
            BufferedImage output =
                    new BufferedImage(
                            input.getWidth(),
                            input.getHeight(),
                            BufferedImage.TYPE_INT_ARGB);
            for (int y = 0; y < input.getHeight(); y++) {
                for (int x = 0; x < input.getWidth(); x++) {
                    int alpha =
                            (input.getRGB(x, y) >>> 24) & 0xFF;
                    output.setRGB(x, y, alpha << 24);
                }
            }
            ByteArrayOutputStream bytes =
                    new ByteArrayOutputStream();
            if (!ImageIO.write(output, "png", bytes)) {
                throw unavailableError();
            }
            return bytes.toByteArray();
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            throw unavailableError();
        }
    }

    private ApiException unavailable() {
        return unavailableError();
    }

    private static ApiException unavailableError() {
        return new ApiException(SILHOUETTE_UNAVAILABLE);
    }
}

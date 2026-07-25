package com.guesspokemon.pokemon;

import java.io.IOException;
import java.io.InputStream;
import java.sql.Timestamp;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Component
public class PokemonCatalogImporter implements ApplicationRunner {

    private static final Logger LOGGER =
            LoggerFactory.getLogger(PokemonCatalogImporter.class);
    private static final int BATCH_SIZE = 100;
    private static final String UPSERT_SQL =
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
            ON CONFLICT (national_dex_id) DO UPDATE
            SET slug = EXCLUDED.slug,
                korean_name = EXCLUDED.korean_name,
                generation = EXCLUDED.generation,
                primary_type = EXCLUDED.primary_type,
                secondary_type = EXCLUDED.secondary_type,
                artwork_url = EXCLUDED.artwork_url,
                catalog_version = EXCLUDED.catalog_version,
                source_updated_at = EXCLUDED.source_updated_at,
                enabled = TRUE
            """;

    private final Resource snapshotResource;
    private final JsonMapper jsonMapper;
    private final PokemonCatalogValidator pokemonCatalogValidator;
    private final JdbcTemplate jdbcTemplate;
    private final TransactionTemplate transactionTemplate;

    public PokemonCatalogImporter(
            @Value("${pokemon.catalog.snapshot-location}")
                    String snapshotLocation,
            ResourceLoader resourceLoader,
            JsonMapper jsonMapper,
            PokemonCatalogValidator pokemonCatalogValidator,
            JdbcTemplate jdbcTemplate,
            TransactionTemplate transactionTemplate) {
        this.snapshotResource =
                resourceLoader.getResource(snapshotLocation);
        this.jsonMapper = jsonMapper;
        this.pokemonCatalogValidator = pokemonCatalogValidator;
        this.jdbcTemplate = jdbcTemplate;
        this.transactionTemplate = transactionTemplate;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        PokemonCatalogSnapshot snapshot = readSnapshot();
        pokemonCatalogValidator.validate(snapshot);
        transactionTemplate.executeWithoutResult(
                transactionStatus -> importIfRequired(snapshot));
    }

    private PokemonCatalogSnapshot readSnapshot() {
        try (InputStream inputStream = snapshotResource.getInputStream()) {
            return jsonMapper.readValue(
                    inputStream,
                    PokemonCatalogSnapshot.class);
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "catalog snapshot을 읽을 수 없습니다.",
                    exception);
        }
    }

    private void importIfRequired(PokemonCatalogSnapshot snapshot) {
        long currentVersionCount =
                countCompleteRowsByVersion(snapshot.catalogVersion());
        long enabledOutdatedRowCount =
                countEnabledRowsOutsideVersion(snapshot.catalogVersion());
        if (currentVersionCount == snapshot.species().size()
                && enabledOutdatedRowCount == 0) {
            LOGGER.info(
                    "Pokemon catalog already current version={} count={}",
                    snapshot.catalogVersion(),
                    currentVersionCount);
            return;
        }

        if (currentVersionCount != snapshot.species().size()) {
            batchUpsert(snapshot);
        }
        disableRowsOutsideVersion(snapshot.catalogVersion());

        long importedCount =
                countCompleteRowsByVersion(snapshot.catalogVersion());
        if (importedCount != snapshot.species().size()) {
            throw new IllegalStateException(
                    "catalog import row 수가 snapshot과 다릅니다.");
        }
        LOGGER.info(
                "Pokemon catalog imported version={} count={}",
                snapshot.catalogVersion(),
                importedCount);
    }

    private void batchUpsert(PokemonCatalogSnapshot snapshot) {
        List<PokemonCatalogSnapshot.Species> species = snapshot.species();
        jdbcTemplate.batchUpdate(
                UPSERT_SQL,
                species,
                BATCH_SIZE,
                (preparedStatement, item) -> {
                    preparedStatement.setInt(1, item.nationalDexId());
                    preparedStatement.setString(2, item.slug());
                    preparedStatement.setString(3, item.koreanName());
                    preparedStatement.setShort(
                            4,
                            (short) item.generation());
                    preparedStatement.setString(
                            5,
                            item.types().getFirst().name());
                    preparedStatement.setString(
                            6,
                            item.types().size() == 2
                                    ? item.types().get(1).name()
                                    : null);
                    preparedStatement.setString(7, item.artworkUrl());
                    preparedStatement.setString(
                            8,
                            snapshot.catalogVersion());
                    preparedStatement.setTimestamp(
                            9,
                            Timestamp.from(snapshot.sourceUpdatedAt()));
                });
    }

    private long countCompleteRowsByVersion(String catalogVersion) {
        Long count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM pokemon_species
                        WHERE catalog_version = ?
                          AND primary_type IS NOT NULL
                        """,
                        Long.class,
                        catalogVersion);
        if (count == null) {
            throw new IllegalStateException(
                    "catalog row 수를 확인할 수 없습니다.");
        }
        return count;
    }

    private long countEnabledRowsOutsideVersion(String catalogVersion) {
        Long count =
                jdbcTemplate.queryForObject(
                        """
                        SELECT COUNT(*)
                        FROM pokemon_species
                        WHERE catalog_version <> ?
                          AND enabled = TRUE
                        """,
                        Long.class,
                        catalogVersion);
        if (count == null) {
            throw new IllegalStateException(
                    "이전 catalog row 수를 확인할 수 없습니다.");
        }
        return count;
    }

    private void disableRowsOutsideVersion(String catalogVersion) {
        jdbcTemplate.update(
                """
                UPDATE pokemon_species
                SET enabled = FALSE
                WHERE catalog_version <> ?
                  AND enabled = TRUE
                """,
                catalogVersion);
    }
}

CREATE TABLE pokemon_species (
    national_dex_id INTEGER NOT NULL,
    slug VARCHAR(80) NOT NULL,
    korean_name VARCHAR(80) NOT NULL,
    generation SMALLINT NOT NULL,
    artwork_url TEXT NOT NULL,
    catalog_version VARCHAR(40) NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_pokemon_species PRIMARY KEY (national_dex_id),
    CONSTRAINT uk_pokemon_species_slug UNIQUE (slug),
    CONSTRAINT uk_pokemon_species_korean_name UNIQUE (korean_name),
    CONSTRAINT ck_pokemon_species_national_dex_id
        CHECK (national_dex_id > 0),
    CONSTRAINT ck_pokemon_species_slug
        CHECK (slug ~ '^[a-z0-9-]+$'),
    CONSTRAINT ck_pokemon_species_korean_name
        CHECK (btrim(korean_name) <> ''),
    CONSTRAINT ck_pokemon_species_generation
        CHECK (generation BETWEEN 1 AND 9),
    CONSTRAINT ck_pokemon_species_artwork_url
        CHECK (artwork_url ~ '^https://'),
    CONSTRAINT ck_pokemon_species_catalog_version
        CHECK (btrim(catalog_version) <> '')
);

CREATE INDEX ix_pokemon_species_korean_name
    ON pokemon_species (korean_name);

CREATE INDEX ix_pokemon_species_generation_national_dex_id
    ON pokemon_species (generation, national_dex_id);

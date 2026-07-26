ALTER TABLE pokemon_species
    ADD COLUMN evolves_from_national_dex_id INTEGER,
    ADD CONSTRAINT fk_pokemon_species_evolves_from
        FOREIGN KEY (evolves_from_national_dex_id)
        REFERENCES pokemon_species (national_dex_id),
    ADD CONSTRAINT ck_pokemon_species_evolves_from_not_self
        CHECK (
            evolves_from_national_dex_id IS NULL
            OR evolves_from_national_dex_id <> national_dex_id
        );

CREATE INDEX ix_pokemon_species_evolves_from
    ON pokemon_species (evolves_from_national_dex_id);

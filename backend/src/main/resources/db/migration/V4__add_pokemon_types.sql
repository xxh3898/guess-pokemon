ALTER TABLE pokemon_species
    ADD COLUMN primary_type VARCHAR(20),
    ADD COLUMN secondary_type VARCHAR(20);

UPDATE pokemon_species
SET enabled = FALSE
WHERE enabled = TRUE;

ALTER TABLE pokemon_species
    ADD CONSTRAINT ck_pokemon_species_primary_type
        CHECK (
            primary_type IS NULL
            OR primary_type IN (
                'BUG',
                'DARK',
                'DRAGON',
                'ELECTRIC',
                'FAIRY',
                'FIGHTING',
                'FIRE',
                'FLYING',
                'GHOST',
                'GRASS',
                'GROUND',
                'ICE',
                'NORMAL',
                'POISON',
                'PSYCHIC',
                'ROCK',
                'STEEL',
                'WATER'
            )
        ),
    ADD CONSTRAINT ck_pokemon_species_secondary_type
        CHECK (
            secondary_type IS NULL
            OR secondary_type IN (
                'BUG',
                'DARK',
                'DRAGON',
                'ELECTRIC',
                'FAIRY',
                'FIGHTING',
                'FIRE',
                'FLYING',
                'GHOST',
                'GRASS',
                'GROUND',
                'ICE',
                'NORMAL',
                'POISON',
                'PSYCHIC',
                'ROCK',
                'STEEL',
                'WATER'
            )
        ),
    ADD CONSTRAINT ck_pokemon_species_secondary_requires_primary
        CHECK (
            secondary_type IS NULL
            OR primary_type IS NOT NULL
        ),
    ADD CONSTRAINT ck_pokemon_species_types_distinct
        CHECK (
            secondary_type IS NULL
            OR primary_type <> secondary_type
        ),
    ADD CONSTRAINT ck_pokemon_species_enabled_primary_type
        CHECK (
            enabled = FALSE
            OR primary_type IS NOT NULL
        );

package com.guesspokemon.pokemon;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;

@Entity
@Table(
        name = "pokemon_species",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_pokemon_species_slug",
                    columnNames = "slug"),
            @UniqueConstraint(
                    name = "uk_pokemon_species_korean_name",
                    columnNames = "korean_name")
        },
        indexes = {
            @Index(
                    name = "ix_pokemon_species_korean_name",
                    columnList = "korean_name"),
            @Index(
                    name = "ix_pokemon_species_generation_national_dex_id",
                    columnList = "generation,national_dex_id")
        })
public class PokemonSpecies {

    @Id
    @Column(name = "national_dex_id", nullable = false)
    private Integer nationalDexId;

    @Column(nullable = false, length = 80)
    private String slug;

    @Column(name = "korean_name", nullable = false, length = 80)
    private String koreanName;

    @Column(nullable = false)
    private Short generation;

    @Column(name = "artwork_url", nullable = false, columnDefinition = "text")
    private String artworkUrl;

    @Column(name = "catalog_version", nullable = false, length = 40)
    private String catalogVersion;

    @Column(name = "source_updated_at", nullable = false)
    private Instant sourceUpdatedAt;

    @Column(nullable = false)
    private boolean enabled;

    protected PokemonSpecies() {
    }

    public Integer getNationalDexId() {
        return nationalDexId;
    }

    public String getSlug() {
        return slug;
    }

    public String getKoreanName() {
        return koreanName;
    }

    public Short getGeneration() {
        return generation;
    }

    public String getArtworkUrl() {
        return artworkUrl;
    }

    public String getCatalogVersion() {
        return catalogVersion;
    }

    public Instant getSourceUpdatedAt() {
        return sourceUpdatedAt;
    }

    public boolean isEnabled() {
        return enabled;
    }
}

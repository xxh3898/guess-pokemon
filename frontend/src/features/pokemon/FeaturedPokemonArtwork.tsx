import { useEffect, useState } from "react";

import { PokemonArtwork } from "./PokemonArtwork";
import {
  pokemonCatalogGateway,
  type PokemonCatalogGateway,
} from "./pokemonApi";
import type { PokemonSummary } from "./pokemonTypes";

const FEATURED_NATIONAL_DEX_ID = 25;
const FEATURED_FALLBACK: PokemonSummary = {
  artworkEnabled: false,
  artworkUrl: null,
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: FEATURED_NATIONAL_DEX_ID,
  types: ["ELECTRIC"],
};

interface FeaturedPokemonArtworkProps {
  className?: string;
  gateway?: PokemonCatalogGateway;
}

type FeaturedPokemonArtworkState =
  | { status: "loading" }
  | { pokemon: PokemonSummary; status: "ready" }
  | { status: "unavailable" };

export function FeaturedPokemonArtwork({
  className = "",
  gateway = pokemonCatalogGateway,
}: FeaturedPokemonArtworkProps) {
  const [state, setState] =
    useState<FeaturedPokemonArtworkState>({
      status: "loading",
    });

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;

    setState({ status: "loading" });
    void gateway
      .findByNationalDexId(
        FEATURED_NATIONAL_DEX_ID,
        controller.signal,
      )
      .then((pokemon) => {
        if (!isActive) {
          return;
        }
        setState(
          pokemon.nationalDexId === FEATURED_NATIONAL_DEX_ID
            ? { pokemon, status: "ready" }
            : { status: "unavailable" },
        );
      })
      .catch(() => {
        if (isActive) {
          setState({ status: "unavailable" });
        }
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [gateway]);

  const artworkClassName =
    `featured-pokemon-artwork ${className}`.trim();

  if (state.status === "loading") {
    return (
      <span
        aria-label="대표 포켓몬 이미지를 불러오는 중"
        className={
          `pokemon-artwork ${artworkClassName} ` +
          "featured-pokemon-artwork--loading"
        }
        role="status"
      >
        <span
          aria-hidden="true"
          className="featured-pokemon-artwork-loading-shape"
        />
      </span>
    );
  }

  return (
    <PokemonArtwork
      className={artworkClassName}
      pokemon={
        state.status === "ready"
          ? state.pokemon
          : FEATURED_FALLBACK
      }
    />
  );
}

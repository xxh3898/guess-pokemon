import { ImageOff } from "lucide-react";
import { useState } from "react";

import type { PokemonSummary } from "./pokemonTypes";

interface PokemonArtworkProps {
  className?: string;
  pokemon: PokemonSummary;
}

export function PokemonArtwork({
  className = "",
  pokemon,
}: PokemonArtworkProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const canRenderArtwork =
    pokemon.artworkEnabled &&
    pokemon.artworkUrl !== null &&
    failedUrl !== pokemon.artworkUrl;

  return (
    <span
      className={`pokemon-artwork ${className}`.trim()}
      data-testid={`pokemon-artwork-${pokemon.nationalDexId}`}
    >
      {canRenderArtwork ? (
        <img
          alt={`${pokemon.koreanName} 공식 일러스트`}
          loading="lazy"
          onError={() => {
            setFailedUrl(pokemon.artworkUrl);
          }}
          src={pokemon.artworkUrl ?? undefined}
        />
      ) : (
        <span
          aria-label={`${pokemon.koreanName} 이미지 준비 중`}
          className="pokemon-artwork-fallback"
          role="img"
        >
          <ImageOff aria-hidden="true" size={30} />
          <strong>{formatNationalDexId(pokemon.nationalDexId)}</strong>
        </span>
      )}
    </span>
  );
}

export function formatNationalDexId(nationalDexId: number): string {
  return `No.${String(nationalDexId).padStart(4, "0")}`;
}

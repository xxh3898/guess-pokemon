import type { PokemonType } from "./pokemonTypes";
import { POKEMON_TYPE_LABELS } from "./pokemonTypes";

const POKEMON_TYPE_CLASS_NAMES: Readonly<
  Record<PokemonType, string>
> = {
  BUG: "pokemon-type-badge--bug",
  DARK: "pokemon-type-badge--dark",
  DRAGON: "pokemon-type-badge--dragon",
  ELECTRIC: "pokemon-type-badge--electric",
  FAIRY: "pokemon-type-badge--fairy",
  FIGHTING: "pokemon-type-badge--fighting",
  FIRE: "pokemon-type-badge--fire",
  FLYING: "pokemon-type-badge--flying",
  GHOST: "pokemon-type-badge--ghost",
  GRASS: "pokemon-type-badge--grass",
  GROUND: "pokemon-type-badge--ground",
  ICE: "pokemon-type-badge--ice",
  NORMAL: "pokemon-type-badge--normal",
  POISON: "pokemon-type-badge--poison",
  PSYCHIC: "pokemon-type-badge--psychic",
  ROCK: "pokemon-type-badge--rock",
  STEEL: "pokemon-type-badge--steel",
  WATER: "pokemon-type-badge--water",
};

interface PokemonTypeBadgesProps {
  types: readonly PokemonType[];
}

export function PokemonTypeBadges({
  types,
}: PokemonTypeBadgesProps) {
  return (
    <span className="pokemon-type-badges">
      <span className="sr-only">타입:</span>
      {types.map((type) => (
        <span
          className={`pokemon-type-badge ${POKEMON_TYPE_CLASS_NAMES[type]}`}
          key={type}
        >
          {POKEMON_TYPE_LABELS[type]}
        </span>
      ))}
    </span>
  );
}

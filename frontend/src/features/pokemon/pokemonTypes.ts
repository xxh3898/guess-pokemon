import { ApiError } from "../../shared/api/HttpClient";
import {
  requireBoolean,
  requireInteger,
  requireRecord,
  requireString,
} from "../../shared/api/responseParsing";

export const POKEMON_TYPES = [
  "BUG",
  "DARK",
  "DRAGON",
  "ELECTRIC",
  "FAIRY",
  "FIGHTING",
  "FIRE",
  "FLYING",
  "GHOST",
  "GRASS",
  "GROUND",
  "ICE",
  "NORMAL",
  "POISON",
  "PSYCHIC",
  "ROCK",
  "STEEL",
  "WATER",
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

export const POKEMON_TYPE_LABELS: Readonly<
  Record<PokemonType, string>
> = {
  BUG: "벌레",
  DARK: "악",
  DRAGON: "드래곤",
  ELECTRIC: "전기",
  FAIRY: "페어리",
  FIGHTING: "격투",
  FIRE: "불꽃",
  FLYING: "비행",
  GHOST: "고스트",
  GRASS: "풀",
  GROUND: "땅",
  ICE: "얼음",
  NORMAL: "노말",
  POISON: "독",
  PSYCHIC: "에스퍼",
  ROCK: "바위",
  STEEL: "강철",
  WATER: "물",
};

const POKEMON_TYPE_SET = new Set<string>(POKEMON_TYPES);

export interface PokemonSummary {
  readonly artworkEnabled: boolean;
  readonly artworkUrl: string | null;
  readonly generation: number;
  readonly koreanName: string;
  readonly nationalDexId: number;
  readonly types: readonly PokemonType[];
}

export interface PokemonPage {
  readonly content: readonly PokemonSummary[];
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
}

export function parsePokemonSummary(
  payload: unknown,
): PokemonSummary {
  const pokemon = requireRecord(payload);
  const artworkEnabled = requireBoolean(
    pokemon,
    "artworkEnabled",
  );
  const artworkUrl = pokemon.artworkUrl;

  if (
    (artworkEnabled &&
      (typeof artworkUrl !== "string" ||
        !isHttpsUrl(artworkUrl))) ||
    (!artworkEnabled && artworkUrl !== null)
  ) {
    throw ApiError.invalidResponse();
  }

  return {
    artworkEnabled,
    artworkUrl: artworkEnabled ? (artworkUrl as string) : null,
    generation: requireInteger(pokemon, "generation", 1, 9),
    koreanName: requireString(pokemon, "koreanName"),
    nationalDexId: requireInteger(
      pokemon,
      "nationalDexId",
      1,
      1_025,
    ),
    types: parsePokemonTypes(pokemon.types),
  };
}

export function parsePokemonPage(payload: unknown): PokemonPage {
  const page = requireRecord(payload);
  if (!Array.isArray(page.content)) {
    throw ApiError.invalidResponse();
  }

  const size = requireInteger(page, "size", 1, 100);
  const content = page.content.map(parsePokemonSummary);
  const totalElements = requireInteger(
    page,
    "totalElements",
    0,
  );
  const totalPages = requireInteger(page, "totalPages", 0);

  if (
    content.length > size ||
    content.length > totalElements ||
    (totalElements === 0 && totalPages !== 0) ||
    (totalElements > 0 && totalPages === 0)
  ) {
    throw ApiError.invalidResponse();
  }

  return {
    content,
    page: requireInteger(page, "page", 0),
    size,
    totalElements,
    totalPages,
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parsePokemonTypes(payload: unknown): readonly PokemonType[] {
  if (
    !Array.isArray(payload) ||
    payload.length < 1 ||
    payload.length > 2
  ) {
    throw ApiError.invalidResponse();
  }

  const types = payload.map((candidate) => {
    if (
      typeof candidate !== "string" ||
      !POKEMON_TYPE_SET.has(candidate)
    ) {
      throw ApiError.invalidResponse();
    }
    return candidate as PokemonType;
  });

  if (new Set(types).size !== types.length) {
    throw ApiError.invalidResponse();
  }
  return types;
}

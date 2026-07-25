import { ApiError } from "../../shared/api/HttpClient";
import {
  requireBoolean,
  requireInteger,
  requireRecord,
  requireString,
} from "../../shared/api/responseParsing";

export interface PokemonSummary {
  readonly artworkEnabled: boolean;
  readonly artworkUrl: string | null;
  readonly generation: number;
  readonly koreanName: string;
  readonly nationalDexId: number;
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

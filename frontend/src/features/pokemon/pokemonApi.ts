import {
  ApiError,
  type ApiPath,
  HttpClient,
  httpClient,
} from "../../shared/api/HttpClient";
import {
  parsePokemonEvolutionDetails,
  parsePokemonPage,
  parsePokemonSummary,
  type PokemonEvolutionDetails,
  type PokemonPage,
  type PokemonSummary,
} from "./pokemonTypes";

const DEFAULT_PAGE_SIZE = 20;
const MAX_QUERY_LENGTH = 80;

export interface PokemonSearchRequest {
  readonly generation: number | null;
  readonly page: number;
  readonly query: string;
  readonly size?: number;
}

export interface PokemonCatalogGateway {
  findByNationalDexId(
    nationalDexId: number,
    signal?: AbortSignal,
  ): Promise<PokemonSummary>;
  search(
    request: PokemonSearchRequest,
    signal?: AbortSignal,
  ): Promise<PokemonPage>;
}

export interface PokemonEvolutionGateway {
  findEvolutionDetails(
    nationalDexId: number,
    signal?: AbortSignal,
  ): Promise<PokemonEvolutionDetails>;
}

export interface PokemonGateway
  extends PokemonCatalogGateway,
    PokemonEvolutionGateway {}

export function createPokemonCatalogGateway(
  client: HttpClient,
): PokemonGateway {
  return {
    async findEvolutionDetails(nationalDexId, signal) {
      requireIntegerInRange(nationalDexId, 1, 1_025);
      const payload = await client.get(
        `/api/v1/pokemon-species/${nationalDexId}/evolutions`,
        signal,
      );
      const details = parsePokemonEvolutionDetails(payload);
      if (details.pokemon.nationalDexId !== nationalDexId) {
        throw ApiError.invalidResponse();
      }
      return details;
    },
    async findByNationalDexId(nationalDexId, signal) {
      requireIntegerInRange(nationalDexId, 1, 1_025);
      const payload = await client.get(
        `/api/v1/pokemon-species/${nationalDexId}`,
        signal,
      );
      return parsePokemonSummary(payload);
    },
    async search(request, signal) {
      const query = request.query.trim().normalize("NFC");
      const size = request.size ?? DEFAULT_PAGE_SIZE;
      if (query.length > MAX_QUERY_LENGTH) {
        throw validationError(
          "검색어는 80자 이내로 입력해 주세요.",
        );
      }
      requireIntegerInRange(request.page, 0);
      requireIntegerInRange(size, 1, 100);
      if (request.generation !== null) {
        requireIntegerInRange(request.generation, 1, 9);
      }

      const search = new URLSearchParams({
        page: String(request.page),
        query,
        size: String(size),
      });
      if (request.generation !== null) {
        search.set("generation", String(request.generation));
      }
      const path: ApiPath =
        `/api/v1/pokemon-species?${search.toString()}`;
      const payload = await client.get(path, signal);
      return parsePokemonPage(payload);
    },
  };
}

export const pokemonCatalogGateway =
  createPokemonCatalogGateway(httpClient);

function requireIntegerInRange(
  value: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): void {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw validationError("도감 검색 조건을 다시 확인해 주세요.");
  }
}

function validationError(detail: string): ApiError {
  return new ApiError({
    code: "VALIDATION_FAILED",
    detail,
    status: 400,
    title: "검색 조건 확인",
  });
}

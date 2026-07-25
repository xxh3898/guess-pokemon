import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  HttpClient,
} from "../../shared/api/HttpClient";
import { createPokemonCatalogGateway } from "./pokemonApi";

const PIKACHU = {
  artworkEnabled: true,
  artworkUrl: "https://example.test/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"],
};

describe("pokemonApi", () => {
  it("should_sendNormalizedSearchQuery_when_filterIsGiven", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [PIKACHU],
        page: 1,
        size: 20,
        totalElements: 21,
        totalPages: 2,
      }),
    );
    const gateway =
      createPokemonCatalogGateway(new HttpClient(fetcher));

    await expect(
      gateway.search({
        generation: 1,
        page: 1,
        query: "  피카  ",
      }),
    ).resolves.toMatchObject({
      content: [PIKACHU],
      page: 1,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/pokemon-species?page=1&query=%ED%94%BC%EC%B9%B4&size=20&generation=1",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("should_fetchPokemonSummary_when_nationalDexIdExists", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse(PIKACHU));
    const gateway =
      createPokemonCatalogGateway(new HttpClient(fetcher));

    await expect(
      gateway.findByNationalDexId(25),
    ).resolves.toEqual(PIKACHU);

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/v1/pokemon-species/25",
    );
  });

  it("should_rejectBeforeFetch_when_searchConditionIsInvalid", async () => {
    const fetcher = vi.fn();
    const gateway =
      createPokemonCatalogGateway(new HttpClient(fetcher));

    await expect(
      gateway.search({
        generation: 10,
        page: 0,
        query: "",
      }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      gateway.findByNationalDexId(0),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

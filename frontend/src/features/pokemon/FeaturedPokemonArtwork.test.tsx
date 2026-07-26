import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FeaturedPokemonArtwork } from "./FeaturedPokemonArtwork";
import type { PokemonCatalogGateway } from "./pokemonApi";
import type { PokemonSummary } from "./pokemonTypes";

const PIKACHU: PokemonSummary = {
  artworkEnabled: true,
  artworkUrl: "https://example.test/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"],
};

describe("FeaturedPokemonArtwork", () => {
  it("should_renderOfficialArtwork_when_featuredSpeciesLoads", async () => {
    const gateway = createGateway(
      vi.fn().mockResolvedValue(PIKACHU),
    );

    render(<FeaturedPokemonArtwork gateway={gateway} />);

    expect(
      screen.getByRole("status", {
        name: "대표 포켓몬 이미지를 불러오는 중",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByAltText("피카츄 공식 일러스트"),
    ).toHaveAttribute("src", PIKACHU.artworkUrl);
    expect(gateway.findByNationalDexId).toHaveBeenCalledWith(
      25,
      expect.any(AbortSignal),
    );
  });

  it("should_renderFallback_when_artworkKillSwitchIsDisabled", async () => {
    const gateway = createGateway(
      vi.fn().mockResolvedValue({
        ...PIKACHU,
        artworkEnabled: false,
        artworkUrl: null,
      }),
    );

    render(<FeaturedPokemonArtwork gateway={gateway} />);

    expect(
      await screen.findByRole("img", {
        name: "피카츄 이미지 준비 중",
      }),
    ).toHaveTextContent("No.0025");
  });

  it("should_renderFallback_when_featuredSpeciesRequestFails", async () => {
    const gateway = createGateway(
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );

    render(<FeaturedPokemonArtwork gateway={gateway} />);

    expect(
      await screen.findByRole("img", {
        name: "피카츄 이미지 준비 중",
      }),
    ).toHaveTextContent("No.0025");
  });

  it("should_renderFallback_when_responseSpeciesDoesNotMatchFeaturedId", async () => {
    const gateway = createGateway(
      vi.fn().mockResolvedValue({
        ...PIKACHU,
        nationalDexId: 26,
      }),
    );

    render(<FeaturedPokemonArtwork gateway={gateway} />);

    expect(
      await screen.findByRole("img", {
        name: "피카츄 이미지 준비 중",
      }),
    ).toHaveTextContent("No.0025");
  });

  it("should_renderFallback_when_officialArtworkFailsToLoad", async () => {
    const gateway = createGateway(
      vi.fn().mockResolvedValue(PIKACHU),
    );

    render(<FeaturedPokemonArtwork gateway={gateway} />);

    fireEvent.error(
      await screen.findByAltText("피카츄 공식 일러스트"),
    );

    expect(
      screen.getByRole("img", {
        name: "피카츄 이미지 준비 중",
      }),
    ).toHaveTextContent("No.0025");
  });

  it("should_abortRequest_when_componentUnmounts", () => {
    const findByNationalDexId = vi.fn(
      (
        _nationalDexId: number,
        _signal?: AbortSignal,
      ) => new Promise<PokemonSummary>(() => undefined),
    );
    const gateway = createGateway(findByNationalDexId);
    const { unmount } = render(
      <FeaturedPokemonArtwork gateway={gateway} />,
    );
    const signal = findByNationalDexId.mock.calls[0]?.[1];

    unmount();

    expect(signal?.aborted).toBe(true);
  });
});

function createGateway(
  findByNationalDexId: PokemonCatalogGateway["findByNationalDexId"],
): PokemonCatalogGateway {
  return {
    findByNationalDexId,
    search: vi.fn(),
  };
}

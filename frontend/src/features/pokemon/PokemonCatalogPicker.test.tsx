import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PokemonCatalogGateway } from "./pokemonApi";
import {
  PokemonArtwork,
} from "./PokemonArtwork";
import { PokemonCatalogPicker } from "./PokemonCatalogPicker";

const PIKACHU = {
  artworkEnabled: true,
  artworkUrl: "https://example.com/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"] as const,
};

describe("PokemonCatalogPicker", () => {
  it("should_searchAndSelectPokemon_when_catalogLoads", async () => {
    const gateway = createGateway();
    const onSelect = vi.fn();
    render(
      <PokemonCatalogPicker
        gateway={gateway}
        onSelect={onSelect}
        selectedPokemon={null}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("이름 또는 도감 번호로 검색"),
      { target: { value: "피카츄" } },
    );
    const card = await screen.findByRole("button", {
      name: /피카츄/,
    });
    expect(within(card).getByText("전기")).toBeInTheDocument();
    fireEvent.click(card);

    expect(onSelect).toHaveBeenCalledWith(PIKACHU);
    await waitFor(() => {
      expect(gateway.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 0,
          query: "피카츄",
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it("should_resetPage_when_generationChanges", async () => {
    const gateway = createGateway({
      totalPages: 2,
    });
    render(
      <PokemonCatalogPicker
        gateway={gateway}
        onSelect={vi.fn()}
        selectedPokemon={null}
      />,
    );
    await screen.findByRole("button", { name: /피카츄/ });
    fireEvent.click(
      screen.getByRole("button", {
        name: "다음 도감 페이지",
      }),
    );
    await waitFor(() => {
      expect(gateway.search).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
        expect.any(AbortSignal),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "1세대" }),
    );

    await waitFor(() => {
      expect(gateway.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          generation: 1,
          page: 0,
        }),
        expect.any(AbortSignal),
      );
    });
  });

  it("should_showEmptyState_when_searchHasNoResults", async () => {
    const gateway: PokemonCatalogGateway = {
      ...createGateway(),
      search: vi.fn().mockResolvedValue({
        content: [],
        page: 0,
        size: 20,
        totalElements: 0,
        totalPages: 0,
      }),
    };

    render(
      <PokemonCatalogPicker
        gateway={gateway}
        onSelect={vi.fn()}
        selectedPokemon={null}
      />,
    );

    expect(
      await screen.findByText("검색 결과가 없어요"),
    ).toBeInTheDocument();
  });

  it("should_retryCatalog_when_requestFails", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({
        content: [PIKACHU],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      });
    const gateway: PokemonCatalogGateway = {
      ...createGateway(),
      search,
    };
    render(
      <PokemonCatalogPicker
        gateway={gateway}
        onSelect={vi.fn()}
        selectedPokemon={null}
      />,
    );

    expect(
      await screen.findByText(
        "전국도감을 불러오지 못했습니다. 다시 시도해 주세요.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "다시 시도" }),
    );

    expect(
      await screen.findByRole("button", { name: /피카츄/ }),
    ).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("should_showFallback_when_artworkCannotLoad", () => {
    render(<PokemonArtwork pokemon={PIKACHU} />);

    fireEvent.error(
      screen.getByRole("img", {
        name: "피카츄 공식 일러스트",
      }),
    );

    expect(
      screen.getByRole("img", {
        name: "피카츄 이미지 준비 중",
      }),
    ).toBeInTheDocument();
  });

  it("should_showFallback_when_artworkIsDisabled", () => {
    render(
      <PokemonArtwork
        pokemon={{
          ...PIKACHU,
          artworkEnabled: false,
          artworkUrl: null,
        }}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "피카츄 이미지 준비 중",
      }),
    ).toBeInTheDocument();
  });
});

function createGateway(
  overrides: { totalPages?: number } = {},
): PokemonCatalogGateway {
  return {
    findByNationalDexId: vi.fn().mockResolvedValue(PIKACHU),
    search: vi.fn().mockResolvedValue({
      content: [PIKACHU],
      page: 0,
      size: 20,
      totalElements: overrides.totalPages ? 21 : 1,
      totalPages: overrides.totalPages ?? 1,
    }),
  };
}

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PokemonEvolutionGateway } from "../pokemon/pokemonApi";
import type {
  PokemonEvolutionDetails,
  PokemonSummary,
} from "../pokemon/pokemonTypes";
import { SelectedPokemonCard } from "./SelectedPokemonCard";

const PIKACHU: PokemonSummary = {
  artworkEnabled: true,
  artworkUrl: "https://example.com/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"],
};

const PICHU: PokemonSummary = {
  ...PIKACHU,
  generation: 2,
  koreanName: "피츄",
  nationalDexId: 172,
};

const RAICHU: PokemonSummary = {
  ...PIKACHU,
  koreanName: "라이츄",
  nationalDexId: 26,
};

const PENDING_GATEWAY: PokemonEvolutionGateway = {
  findEvolutionDetails: vi.fn(
    () =>
      new Promise<PokemonEvolutionDetails>(() => undefined),
  ),
};

describe("SelectedPokemonCard", () => {
  it("should_renderGenerationAndDirectEvolutions_when_detailsLoad", async () => {
    const onOpenPokedex = vi.fn();
    render(
      <SelectedPokemonCard
        evolutionGateway={createGateway({
          nextEvolutions: [RAICHU],
          pokemon: PIKACHU,
          previousEvolution: PICHU,
        })}
        onOpenPokedex={onOpenPokedex}
        paused={false}
        pokemon={PIKACHU}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /피카츄/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("1세대")).toBeInTheDocument();
    expect(await screen.findByText("피츄")).toBeInTheDocument();
    expect(screen.getByText("라이츄")).toBeInTheDocument();
    expect(screen.getByText("진화 전")).toBeInTheDocument();
    expect(screen.getByText("진화 후")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "전국도감 보기" }),
    );
    expect(onOpenPokedex).toHaveBeenCalledOnce();
  });

  it("should_renderEmptyEvolutionState_when_directRelationsDoNotExist", async () => {
    render(
      <SelectedPokemonCard
        evolutionGateway={createGateway({
          nextEvolutions: [],
          pokemon: PIKACHU,
          previousEvolution: null,
        })}
        onOpenPokedex={vi.fn()}
        paused={false}
        pokemon={PIKACHU}
      />,
    );

    expect(
      await screen.findByText(
        "직접 연결된 진화 포켓몬이 없어요.",
      ),
    ).toBeInTheDocument();
  });

  it("should_retryEvolutionRequest_when_firstRequestFails", async () => {
    const findEvolutionDetails = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({
        nextEvolutions: [],
        pokemon: PIKACHU,
        previousEvolution: null,
      });
    render(
      <SelectedPokemonCard
        evolutionGateway={{ findEvolutionDetails }}
        onOpenPokedex={vi.fn()}
        paused={false}
        pokemon={PIKACHU}
      />,
    );

    expect(
      await screen.findByText(
        "진화 정보를 불러오지 못했어요.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "진화 정보 다시 불러오기",
      }),
    );

    expect(
      await screen.findByText(
        "직접 연결된 진화 포켓몬이 없어요.",
      ),
    ).toBeInTheDocument();
    expect(findEvolutionDetails).toHaveBeenCalledTimes(2);
  });

  it("should_abortEvolutionRequest_when_componentUnmounts", async () => {
    const findEvolutionDetails = vi.fn(
      (
        _nationalDexId: number,
        _signal?: AbortSignal,
      ) => new Promise<PokemonEvolutionDetails>(() => undefined),
    );
    const { unmount } = render(
      <SelectedPokemonCard
        evolutionGateway={{ findEvolutionDetails }}
        onOpenPokedex={vi.fn()}
        paused={false}
        pokemon={PIKACHU}
      />,
    );
    await waitFor(() => {
      expect(findEvolutionDetails).toHaveBeenCalledOnce();
    });
    const signal = findEvolutionDetails.mock.calls[0]?.[1];

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("should_disablePokedexButton_when_gameIsPaused", () => {
    render(
      <SelectedPokemonCard
        evolutionGateway={PENDING_GATEWAY}
        onOpenPokedex={vi.fn()}
        paused
        pokemon={PIKACHU}
      />,
    );

    expect(
      screen.getByRole("button", { name: "전국도감 보기" }),
    ).toBeDisabled();
  });
});

function createGateway(
  details: PokemonEvolutionDetails,
): PokemonEvolutionGateway {
  return {
    findEvolutionDetails: vi.fn().mockResolvedValue(details),
  };
}

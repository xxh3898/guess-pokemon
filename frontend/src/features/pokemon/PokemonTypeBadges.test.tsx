import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PokemonTypeBadges } from "./PokemonTypeBadges";
import {
  POKEMON_TYPES,
  POKEMON_TYPE_LABELS,
} from "./pokemonTypes";

describe("PokemonTypeBadges", () => {
  it("should_renderKoreanLabelAndExplicitClass_when_typeIsGiven", () => {
    for (const type of POKEMON_TYPES) {
      const { unmount } = render(
        <PokemonTypeBadges types={[type]} />,
      );

      const badge = screen.getByText(
        POKEMON_TYPE_LABELS[type],
      );
      expect(badge).toHaveClass(
        `pokemon-type-badge--${type.toLowerCase()}`,
      );
      expect(screen.getByText("타입:")).toHaveClass("sr-only");
      unmount();
    }
  });

  it("should_renderTwoBadgesInApiOrder_when_pokemonHasDualTypes", () => {
    render(
      <PokemonTypeBadges types={["GRASS", "POISON"]} />,
    );

    expect(
      screen
        .getAllByText(/풀|독/)
        .map((element) => element.textContent),
    ).toEqual(["풀", "독"]);
  });
});

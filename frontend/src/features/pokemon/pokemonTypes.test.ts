import { describe, expect, it } from "vitest";

import {
  parsePokemonPage,
  parsePokemonSummary,
} from "./pokemonTypes";

const PIKACHU = {
  artworkEnabled: true,
  artworkUrl:
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
};

describe("pokemonTypes", () => {
  it("should_parsePokemonSummary_when_catalogPayloadIsValid", () => {
    expect(parsePokemonSummary(PIKACHU)).toEqual(PIKACHU);
  });

  it("should_parseDisabledArtwork_when_killSwitchIsOff", () => {
    expect(
      parsePokemonSummary({
        ...PIKACHU,
        artworkEnabled: false,
        artworkUrl: null,
      }),
    ).toMatchObject({
      artworkEnabled: false,
      artworkUrl: null,
    });
  });

  it("should_rejectPokemonSummary_when_artworkContractIsInvalid", () => {
    expect(() =>
      parsePokemonSummary({
        ...PIKACHU,
        artworkUrl: "http://example.test/25.png",
      }),
    ).toThrow();
    expect(() =>
      parsePokemonSummary({
        ...PIKACHU,
        artworkEnabled: false,
      }),
    ).toThrow();
  });

  it("should_parsePokemonPage_when_pageMetadataIsValid", () => {
    expect(
      parsePokemonPage({
        content: [PIKACHU],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      }),
    ).toEqual({
      content: [PIKACHU],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });
  });

  it("should_rejectPokemonPage_when_contentExceedsPageSize", () => {
    expect(() =>
      parsePokemonPage({
        content: [PIKACHU],
        page: 0,
        size: 0,
        totalElements: 1,
        totalPages: 1,
      }),
    ).toThrow();
  });
});

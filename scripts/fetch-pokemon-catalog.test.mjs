import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_NATIONAL_DEX_MAX,
  buildSnapshot,
  buildSpeciesRecord,
  mapWithConcurrency,
  parseGeneration,
  validateSpeciesCount,
  validateSpeciesRecords,
} from "./fetch-pokemon-catalog.mjs";

function createSpecies(overrides = {}) {
  return {
    id: 25,
    name: "pikachu",
    names: [
      {
        name: "피카츄",
        language: {
          name: "ko",
        },
      },
    ],
    generation: {
      name: "generation-i",
    },
    varieties: [
      {
        is_default: true,
        pokemon: {
          url: "https://pokeapi.co/api/v2/pokemon/25/",
        },
      },
    ],
    ...overrides,
  };
}

function createPokemon(overrides = {}) {
  return {
    id: 25,
    is_default: true,
    species: {
      url: "https://pokeapi.co/api/v2/pokemon-species/25/",
    },
    sprites: {
      other: {
        "official-artwork": {
          front_default:
            "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
        },
      },
    },
    types: [
      {
        slot: 1,
        type: {
          name: "electric",
        },
      },
    ],
    ...overrides,
  };
}

function createCompleteRecords() {
  return Array.from(
    { length: EXPECTED_NATIONAL_DEX_MAX },
    (_, index) => ({
      nationalDexId: index + 1,
      slug: `pokemon-${index + 1}`,
      koreanName: `포켓몬-${index + 1}`,
      generation: Math.min(Math.floor(index / 130) + 1, 9),
      artworkUrl:
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/` +
        `sprites/pokemon/other/official-artwork/${index + 1}.png`,
      types: ["NORMAL"],
    }),
  );
}

test("should_parseGeneration_when_supportedNameIsGiven", () => {
  assert.equal(parseGeneration("generation-i"), 1);
  assert.equal(parseGeneration("generation-ix"), 9);
});

test("should_rejectGeneration_when_nameIsUnsupported", () => {
  assert.throws(
    () => parseGeneration("generation-x"),
    /지원하지 않는 generation/,
  );
});

test("should_buildSpeciesRecord_when_requiredResourcesAreComplete", () => {
  assert.deepEqual(buildSpeciesRecord(createSpecies(), createPokemon()), {
    nationalDexId: 25,
    slug: "pikachu",
    koreanName: "피카츄",
    generation: 1,
    artworkUrl:
      "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
    types: ["ELECTRIC"],
  });
});

test("should_preserveSlotOrder_when_pokemonHasTwoTypes", () => {
  const pokemon = createPokemon({
    types: [
      {
        slot: 2,
        type: {
          name: "poison",
        },
      },
      {
        slot: 1,
        type: {
          name: "grass",
        },
      },
    ],
  });

  const record = buildSpeciesRecord(createSpecies(), pokemon);

  assert.deepEqual(record.types, ["GRASS", "POISON"]);
});

test("should_rejectPokemonTypes_when_typeCountIsInvalid", () => {
  assert.throws(
    () =>
      buildSpeciesRecord(
        createSpecies(),
        createPokemon({ types: [] }),
      ),
    /타입은 1개 또는 2개여야 합니다/,
  );
  assert.throws(
    () =>
      buildSpeciesRecord(
        createSpecies(),
        createPokemon({
          types: [
            { slot: 1, type: { name: "grass" } },
            { slot: 2, type: { name: "poison" } },
            { slot: 3, type: { name: "flying" } },
          ],
        }),
      ),
    /타입은 1개 또는 2개여야 합니다/,
  );
});

test("should_rejectPokemonTypes_when_typeIsDuplicated", () => {
  assert.throws(
    () =>
      buildSpeciesRecord(
        createSpecies(),
        createPokemon({
          types: [
            { slot: 1, type: { name: "electric" } },
            { slot: 2, type: { name: "electric" } },
          ],
        }),
      ),
    /중복 타입/,
  );
});

test("should_rejectPokemonTypes_when_typeIsUnsupported", () => {
  assert.throws(
    () =>
      buildSpeciesRecord(
        createSpecies(),
        createPokemon({
          types: [
            { slot: 1, type: { name: "stellar" } },
          ],
        }),
      ),
    /지원하지 않는 타입/,
  );
});

test("should_rejectPokemonTypes_when_slotIsNotConsecutive", () => {
  assert.throws(
    () =>
      buildSpeciesRecord(
        createSpecies(),
        createPokemon({
          types: [
            { slot: 2, type: { name: "electric" } },
          ],
        }),
      ),
    /타입 slot이 연속적이지 않습니다/,
  );
});

test("should_rejectSpecies_when_koreanNameIsMissing", () => {
  assert.throws(
    () => buildSpeciesRecord(createSpecies({ names: [] }), createPokemon()),
    /한국어 이름은 정확히 하나/,
  );
});

test("should_rejectSpecies_when_defaultVarietyIsAmbiguous", () => {
  const defaultVariety = createSpecies().varieties[0];
  assert.throws(
    () =>
      buildSpeciesRecord(
        createSpecies({ varieties: [defaultVariety, defaultVariety] }),
        createPokemon(),
      ),
    /default variety는 정확히 하나/,
  );
});

test("should_rejectSpecies_when_officialArtworkIsMissing", () => {
  assert.throws(
    () =>
      buildSpeciesRecord(
        createSpecies(),
        createPokemon({
          sprites: {
            other: {
              "official-artwork": {
                front_default: null,
              },
            },
          },
        }),
      ),
    /official artwork URL 값이 없습니다/,
  );
});

test("should_rejectSpeciesCount_when_upstreamScopeChanges", () => {
  assert.throws(
    () => validateSpeciesCount(EXPECTED_NATIONAL_DEX_MAX + 1),
    /species count가 승인 범위와 다릅니다/,
  );
});

test("should_sortAndValidateRecords_when_snapshotIsComplete", () => {
  const records = createCompleteRecords().reverse();

  const result = validateSpeciesRecords(records);

  assert.equal(result[0].nationalDexId, 1);
  assert.equal(result.at(-1).nationalDexId, EXPECTED_NATIONAL_DEX_MAX);
});

test("should_rejectRecords_when_nationalDexIdIsMissing", () => {
  const records = createCompleteRecords();
  records.splice(24, 1);
  records.push({
    ...records.at(-1),
    nationalDexId: EXPECTED_NATIONAL_DEX_MAX + 1,
    slug: "unexpected",
    koreanName: "범위밖",
  });

  assert.throws(
    () => validateSpeciesRecords(records),
    /National Dex ID가 연속적이지 않습니다/,
  );
});

test("should_rejectRecords_when_koreanNameIsDuplicated", () => {
  const records = createCompleteRecords();
  records[1] = {
    ...records[1],
    koreanName: records[0].koreanName,
  };

  assert.throws(
    () => validateSpeciesRecords(records),
    /중복 한국어 이름/,
  );
});

test("should_rejectRecords_when_typesAreInvalid", () => {
  const records = createCompleteRecords();
  records[0] = {
    ...records[0],
    types: ["NORMAL", "NORMAL"],
  };

  assert.throws(
    () => validateSpeciesRecords(records),
    /중복 타입/,
  );
});

test("should_preserveTimestamp_when_catalogContentIsUnchanged", () => {
  const records = createCompleteRecords();
  const initialSnapshot = buildSnapshot(
    records,
    undefined,
    new Date("2026-07-25T01:00:00.000Z"),
  );

  const regeneratedSnapshot = buildSnapshot(
    records,
    initialSnapshot,
    new Date("2026-07-26T01:00:00.000Z"),
  );

  assert.equal(
    regeneratedSnapshot.catalogVersion,
    initialSnapshot.catalogVersion,
  );
  assert.equal(
    regeneratedSnapshot.sourceUpdatedAt,
    initialSnapshot.sourceUpdatedAt,
  );
});

test("should_keepResultOrder_when_concurrentMapperCompletesOutOfOrder", async () => {
  const result = await mapWithConcurrency([1, 2, 3], 2, async (value) => {
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, (4 - value) * 2);
    });
    return value * 10;
  });

  assert.deepEqual(result, [10, 20, 30]);
});

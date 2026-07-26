import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EXPECTED_NATIONAL_DEX_MAX = 1025;

const POKEAPI_BASE_URL = "https://pokeapi.co/api/v2";
const CATALOG_SOURCE = `${POKEAPI_BASE_URL}/`;
const DEFAULT_OUTPUT_PATH =
  "backend/src/main/resources/catalog/pokemon-species.json";
const DEFAULT_CACHE_PATH = "scripts/.cache/pokeapi";
const REQUEST_CONCURRENCY = 6;
const REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MILLISECONDS = 500;
const CATALOG_VERSION_HASH_LENGTH = 20;
const POKEMON_TYPE_CODES = new Set([
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
]);

const GENERATIONS = new Map([
  ["generation-i", 1],
  ["generation-ii", 2],
  ["generation-iii", 3],
  ["generation-iv", 4],
  ["generation-v", 5],
  ["generation-vi", 6],
  ["generation-vii", 7],
  ["generation-viii", 8],
  ["generation-ix", 9],
]);

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNonBlankString(value, fieldName) {
  assertCondition(
    typeof value === "string" && value.trim().length > 0,
    `${fieldName} 값이 없습니다.`,
  );
  return value;
}

function parseResourceId(resourceUrl, resourceName) {
  const parsedUrl = new URL(
    assertNonBlankString(resourceUrl, `${resourceName} resource URL`),
  );
  const pattern = new RegExp(`/api/v2/${resourceName}/(\\d+)/?$`);
  const match = parsedUrl.pathname.match(pattern);
  assertCondition(
    match !== null,
    `${resourceName} resource ID를 URL에서 찾을 수 없습니다: ${resourceUrl}`,
  );
  return Number.parseInt(match[1], 10);
}

function parseEvolvesFromNationalDexId(species) {
  assertCondition(
    Object.hasOwn(species, "evolves_from_species"),
    `species ${species.id} evolves_from_species가 없습니다.`,
  );
  if (species.evolves_from_species === null) {
    return null;
  }
  const evolvesFromNationalDexId = parseResourceId(
    species.evolves_from_species?.url,
    "pokemon-species",
  );
  assertCondition(
    evolvesFromNationalDexId >= 1 &&
      evolvesFromNationalDexId <= EXPECTED_NATIONAL_DEX_MAX,
    `species ${species.id} 이전 진화 종이 승인 범위를 벗어났습니다: ${evolvesFromNationalDexId}`,
  );
  assertCondition(
    evolvesFromNationalDexId !== species.id,
    `species ${species.id} 이전 진화 종이 자기 자신입니다.`,
  );
  return evolvesFromNationalDexId;
}

export function parseGeneration(generationName) {
  const generation = GENERATIONS.get(generationName);
  assertCondition(
    generation !== undefined,
    `지원하지 않는 generation입니다: ${generationName}`,
  );
  return generation;
}

export function validateSpeciesCount(count) {
  assertCondition(
    Number.isInteger(count),
    "PokéAPI species count가 정수가 아닙니다.",
  );
  assertCondition(
    count === EXPECTED_NATIONAL_DEX_MAX,
    `PokéAPI species count가 승인 범위와 다릅니다: expected=${EXPECTED_NATIONAL_DEX_MAX}, actual=${count}`,
  );
}

function validatePokemonTypeCodes(types, fieldName) {
  assertCondition(
    Array.isArray(types) && (types.length === 1 || types.length === 2),
    `${fieldName} 타입은 1개 또는 2개여야 합니다.`,
  );
  const uniqueTypes = new Set();
  types.forEach((type) => {
    assertCondition(
      typeof type === "string" && POKEMON_TYPE_CODES.has(type),
      `${fieldName} 지원하지 않는 타입입니다: ${type}`,
    );
    assertCondition(
      !uniqueTypes.has(type),
      `${fieldName} 중복 타입입니다: ${type}`,
    );
    uniqueTypes.add(type);
  });
  return types;
}

function parsePokemonTypes(types, nationalDexId) {
  assertCondition(
    Array.isArray(types) && (types.length === 1 || types.length === 2),
    `species ${nationalDexId} 타입은 1개 또는 2개여야 합니다.`,
  );
  const sortedTypes = [...types].sort((left, right) => left.slot - right.slot);
  const typeCodes = sortedTypes.map((entry, index) => {
    const expectedSlot = index + 1;
    assertCondition(
      Number.isInteger(entry?.slot) && entry.slot === expectedSlot,
      `species ${nationalDexId} 타입 slot이 연속적이지 않습니다: expected=${expectedSlot}, actual=${entry?.slot}`,
    );
    const typeName = assertNonBlankString(
      entry?.type?.name,
      `species ${nationalDexId} type name`,
    );
    return typeName.toUpperCase();
  });
  return validatePokemonTypeCodes(
    typeCodes,
    `species ${nationalDexId}`,
  );
}

export function buildSpeciesRecord(species, pokemon) {
  assertCondition(
    Number.isInteger(species?.id),
    "species.id가 정수가 아닙니다.",
  );
  assertCondition(
    species.id >= 1 && species.id <= EXPECTED_NATIONAL_DEX_MAX,
    `species.id가 승인 범위를 벗어났습니다: ${species.id}`,
  );

  const slug = assertNonBlankString(species.name, "species.name");
  assertCondition(
    /^[a-z0-9-]+$/.test(slug),
    `species slug 형식이 올바르지 않습니다: ${slug}`,
  );

  const koreanNames = (species.names ?? []).filter(
    (name) => name?.language?.name === "ko",
  );
  assertCondition(
    koreanNames.length === 1,
    `한국어 이름은 정확히 하나여야 합니다: id=${species.id}, count=${koreanNames.length}`,
  );
  const koreanName = assertNonBlankString(
    koreanNames[0].name,
    `species ${species.id} 한국어 이름`,
  ).normalize("NFC");

  const defaultVarieties = (species.varieties ?? []).filter(
    (variety) => variety?.is_default === true,
  );
  assertCondition(
    defaultVarieties.length === 1,
    `default variety는 정확히 하나여야 합니다: id=${species.id}, count=${defaultVarieties.length}`,
  );
  const defaultPokemonId = parseResourceId(
    defaultVarieties[0].pokemon?.url,
    "pokemon",
  );
  assertCondition(
    pokemon?.id === defaultPokemonId,
    `default Pokémon ID가 일치하지 않습니다: species=${species.id}, expected=${defaultPokemonId}, actual=${pokemon?.id}`,
  );
  assertCondition(
    pokemon?.is_default === true,
    `default Pokémon resource가 아닙니다: species=${species.id}`,
  );
  assertCondition(
    parseResourceId(pokemon?.species?.url, "pokemon-species") === species.id,
    `Pokémon species 참조가 일치하지 않습니다: species=${species.id}`,
  );

  const artworkUrl = assertNonBlankString(
    pokemon?.sprites?.other?.["official-artwork"]?.front_default,
    `species ${species.id} official artwork URL`,
  );
  const parsedArtworkUrl = new URL(artworkUrl);
  assertCondition(
    parsedArtworkUrl.protocol === "https:",
    `official artwork URL은 HTTPS여야 합니다: id=${species.id}`,
  );

  return {
    nationalDexId: species.id,
    slug,
    koreanName,
    generation: parseGeneration(species.generation?.name),
    evolvesFromNationalDexId:
      parseEvolvesFromNationalDexId(species),
    artworkUrl,
    types: parsePokemonTypes(pokemon.types, species.id),
  };
}

function validateEvolutionRelations(sortedRecords) {
  const recordsByNationalDexId = new Map(
    sortedRecords.map((record) => [record.nationalDexId, record]),
  );
  sortedRecords.forEach((record) => {
    const evolvesFromNationalDexId = record.evolvesFromNationalDexId;
    assertCondition(
      evolvesFromNationalDexId === null ||
        Number.isInteger(evolvesFromNationalDexId),
      `species ${record.nationalDexId} 이전 진화 종 번호가 올바르지 않습니다.`,
    );
    if (evolvesFromNationalDexId === null) {
      return;
    }
    assertCondition(
      evolvesFromNationalDexId !== record.nationalDexId,
      `species ${record.nationalDexId} 이전 진화 종이 자기 자신입니다.`,
    );
    assertCondition(
      recordsByNationalDexId.has(evolvesFromNationalDexId),
      `species ${record.nationalDexId} 이전 진화 종을 찾을 수 없습니다: ${evolvesFromNationalDexId}`,
    );
  });

  sortedRecords.forEach((record) => {
    const path = new Set();
    let currentNationalDexId = record.nationalDexId;
    while (currentNationalDexId !== null) {
      assertCondition(
        !path.has(currentNationalDexId),
        `species ${record.nationalDexId} 진화 관계에 cycle이 있습니다.`,
      );
      path.add(currentNationalDexId);
      currentNationalDexId =
        recordsByNationalDexId.get(
          currentNationalDexId,
        ).evolvesFromNationalDexId;
    }
  });
}

export function validateSpeciesRecords(speciesRecords) {
  assertCondition(
    Array.isArray(speciesRecords),
    "species 목록이 배열이 아닙니다.",
  );
  assertCondition(
    speciesRecords.length === EXPECTED_NATIONAL_DEX_MAX,
    `species 개수가 승인 범위와 다릅니다: expected=${EXPECTED_NATIONAL_DEX_MAX}, actual=${speciesRecords.length}`,
  );

  const sortedRecords = [...speciesRecords].sort(
    (left, right) => left.nationalDexId - right.nationalDexId,
  );
  const slugs = new Set();
  const koreanNames = new Set();

  sortedRecords.forEach((record, index) => {
    const expectedId = index + 1;
    assertCondition(
      record.nationalDexId === expectedId,
      `National Dex ID가 연속적이지 않습니다: expected=${expectedId}, actual=${record.nationalDexId}`,
    );
    assertCondition(
      !slugs.has(record.slug),
      `중복 species slug입니다: ${record.slug}`,
    );
    assertCondition(
      !koreanNames.has(record.koreanName),
      `중복 한국어 이름입니다: ${record.koreanName}`,
    );
    assertCondition(
      Number.isInteger(record.generation) &&
        record.generation >= 1 &&
        record.generation <= 9,
      `generation 범위가 올바르지 않습니다: id=${record.nationalDexId}`,
    );
    assertCondition(
      new URL(record.artworkUrl).protocol === "https:",
      `official artwork URL은 HTTPS여야 합니다: id=${record.nationalDexId}`,
    );
    validatePokemonTypeCodes(
      record.types,
      `species ${record.nationalDexId}`,
    );
    slugs.add(record.slug);
    koreanNames.add(record.koreanName);
  });
  validateEvolutionRelations(sortedRecords);

  return sortedRecords;
}

function canonicalSpeciesJson(speciesRecords) {
  return JSON.stringify(speciesRecords);
}

export function buildSnapshot(speciesRecords, previousSnapshot, now) {
  const sortedRecords = validateSpeciesRecords(speciesRecords);
  const contentHash = createHash("sha256")
    .update(canonicalSpeciesJson(sortedRecords))
    .digest("hex");
  const catalogVersion =
    `pokeapi-v2-${contentHash.slice(0, CATALOG_VERSION_HASH_LENGTH)}`;
  const sourceUpdatedAt =
    previousSnapshot?.catalogVersion === catalogVersion
      ? previousSnapshot.sourceUpdatedAt
      : now.toISOString();

  return {
    catalogVersion,
    source: CATALOG_SOURCE,
    sourceUpdatedAt,
    expectedNationalDexMax: EXPECTED_NATIONAL_DEX_MAX,
    species: sortedRecords,
  };
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  assertCondition(
    Number.isInteger(concurrency) && concurrency > 0,
    "동시 요청 수는 양수 정수여야 합니다.",
  );
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

async function fetchJsonWithRetry(url, fetchImpl = fetch) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Guess-Pokemon-Catalog/0.1",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (response.ok) {
        return await response.json();
      }
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`HTTP ${response.status}`);
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < MAX_REQUEST_ATTEMPTS) {
      await delay(RETRY_BASE_DELAY_MILLISECONDS * attempt);
    }
  }

  throw new Error(
    `PokéAPI 요청에 실패했습니다: ${url} (${lastError?.message ?? "unknown error"})`,
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw new Error(
      `JSON 파일을 읽을 수 없습니다: ${filePath} (${error.message})`,
    );
  }
}

async function writeJsonAtomically(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

async function fetchJsonCached(url, cachePath, refresh, fetchImpl = fetch) {
  if (!refresh) {
    const cachedValue = await readJsonIfExists(cachePath);
    if (cachedValue !== undefined) {
      return cachedValue;
    }
  }

  const value = await fetchJsonWithRetry(url, fetchImpl);
  await writeJsonAtomically(cachePath, value);
  return value;
}

function parseArguments(argumentsList) {
  const unknownArguments = argumentsList.filter(
    (argument) => argument !== "--refresh",
  );
  assertCondition(
    unknownArguments.length === 0,
    `지원하지 않는 argument입니다: ${unknownArguments.join(", ")}`,
  );
  return {
    refresh: argumentsList.includes("--refresh"),
  };
}

export async function generateCatalog({
  rootDirectory = process.cwd(),
  refresh = false,
  fetchImpl = fetch,
  now = new Date(),
  onProgress = () => {},
} = {}) {
  const outputPath = resolve(rootDirectory, DEFAULT_OUTPUT_PATH);
  const cacheDirectory = resolve(rootDirectory, DEFAULT_CACHE_PATH);
  const listUrl = `${POKEAPI_BASE_URL}/pokemon-species?limit=1`;
  const listResponse = await fetchJsonWithRetry(listUrl, fetchImpl);
  validateSpeciesCount(listResponse.count);
  await writeJsonAtomically(
    resolve(cacheDirectory, "pokemon-species-list.json"),
    listResponse,
  );

  const nationalDexIds = Array.from(
    { length: EXPECTED_NATIONAL_DEX_MAX },
    (_, index) => index + 1,
  );
  let completedCount = 0;
  const speciesRecords = await mapWithConcurrency(
    nationalDexIds,
    REQUEST_CONCURRENCY,
    async (nationalDexId) => {
      const species = await fetchJsonCached(
        `${POKEAPI_BASE_URL}/pokemon-species/${nationalDexId}/`,
        resolve(cacheDirectory, "pokemon-species", `${nationalDexId}.json`),
        refresh,
        fetchImpl,
      );
      const defaultVarieties = (species.varieties ?? []).filter(
        (variety) => variety?.is_default === true,
      );
      assertCondition(
        defaultVarieties.length === 1,
        `default variety는 정확히 하나여야 합니다: id=${nationalDexId}, count=${defaultVarieties.length}`,
      );
      const defaultPokemonId = parseResourceId(
        defaultVarieties[0].pokemon?.url,
        "pokemon",
      );
      const pokemon = await fetchJsonCached(
        `${POKEAPI_BASE_URL}/pokemon/${defaultPokemonId}/`,
        resolve(cacheDirectory, "pokemon", `${defaultPokemonId}.json`),
        refresh,
        fetchImpl,
      );
      const speciesRecord = buildSpeciesRecord(species, pokemon);
      completedCount += 1;
      if (
        completedCount % 50 === 0 ||
        completedCount === nationalDexIds.length
      ) {
        onProgress(completedCount, nationalDexIds.length);
      }
      return speciesRecord;
    },
  );

  const previousSnapshot = await readJsonIfExists(outputPath);
  const snapshot = buildSnapshot(speciesRecords, previousSnapshot, now);
  await writeJsonAtomically(outputPath, snapshot);
  return snapshot;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const snapshot = await generateCatalog({
    ...options,
    onProgress(completed, total) {
      process.stdout.write(`catalog fetch ${completed}/${total}\n`);
    },
  });
  process.stdout.write(
    `catalog generated version=${snapshot.catalogVersion} count=${snapshot.species.length}\n`,
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

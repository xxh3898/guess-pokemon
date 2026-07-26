import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
} from "lucide-react";
import {
  useEffect,
  useId,
  useState,
} from "react";

import { ApiError } from "../../shared/api/HttpClient";
import {
  type PokemonCatalogGateway,
  pokemonCatalogGateway,
} from "./pokemonApi";
import {
  PokemonArtwork,
  formatNationalDexId,
} from "./PokemonArtwork";
import { PokemonTypeBadges } from "./PokemonTypeBadges";
import type {
  PokemonPage,
  PokemonSummary,
} from "./pokemonTypes";

const GENERATIONS = Array.from(
  { length: 9 },
  (_, index) => index + 1,
);
const EMPTY_DISABLED_NATIONAL_DEX_IDS: ReadonlySet<number> =
  new Set();

interface PokemonCatalogPickerProps {
  disabledNationalDexIds?: ReadonlySet<number>;
  gateway?: PokemonCatalogGateway;
  onSelect(pokemon: PokemonSummary): void;
  selectedPokemon: PokemonSummary | null;
}

export function PokemonCatalogPicker({
  disabledNationalDexIds = EMPTY_DISABLED_NATIONAL_DEX_IDS,
  gateway = pokemonCatalogGateway,
  onSelect,
  selectedPokemon,
}: PokemonCatalogPickerProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState<number | null>(
    null,
  );
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PokemonPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void gateway
      .search(
        {
          generation,
          page,
          query,
        },
        controller.signal,
      )
      .then((response) => {
        if (active) {
          setResult(response);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause)) {
          return;
        }
        setError(toSafeDetail(cause));
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [gateway, generation, page, query, reloadKey]);

  const selectGeneration = (value: number | null) => {
    setGeneration(value);
    setPage(0);
  };

  return (
    <section
      aria-label="전국도감 포켓몬 찾기"
      className="pokemon-catalog-picker"
    >
      <label className="pokemon-search" htmlFor={searchId}>
        <Search aria-hidden="true" size={19} />
        <input
          autoComplete="off"
          id={searchId}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="이름 또는 도감 번호로 검색"
          type="search"
          value={query}
        />
      </label>

      <div
        aria-label="세대 선택"
        className="generation-filters"
        role="group"
      >
        <button
          aria-pressed={generation === null}
          className={generation === null ? "is-active" : ""}
          onClick={() => {
            selectGeneration(null);
          }}
          type="button"
        >
          전체
        </button>
        {GENERATIONS.map((value) => (
          <button
            aria-pressed={generation === value}
            className={generation === value ? "is-active" : ""}
            key={value}
            onClick={() => {
              selectGeneration(value);
            }}
            type="button"
          >
            {value}세대
          </button>
        ))}
      </div>

      <CatalogContent
        disabledNationalDexIds={disabledNationalDexIds}
        error={error}
        loading={loading}
        onRetry={() => {
          setReloadKey((current) => current + 1);
        }}
        onSelect={onSelect}
        result={result}
        selectedPokemon={selectedPokemon}
      />

      {result && result.totalPages > 0 ? (
        <nav
          aria-label="도감 페이지"
          className="pokemon-pagination"
        >
          <button
            aria-label="이전 도감 페이지"
            disabled={page === 0 || loading}
            onClick={() => {
              setPage((current) => current - 1);
            }}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={19} />
          </button>
          <strong>{page + 1}</strong>
          <span>/ {result.totalPages}</span>
          <button
            aria-label="다음 도감 페이지"
            disabled={
              page + 1 >= result.totalPages || loading
            }
            onClick={() => {
              setPage((current) => current + 1);
            }}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={19} />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

interface CatalogContentProps {
  disabledNationalDexIds: ReadonlySet<number>;
  error: string | null;
  loading: boolean;
  onRetry(): void;
  onSelect(pokemon: PokemonSummary): void;
  result: PokemonPage | null;
  selectedPokemon: PokemonSummary | null;
}

function CatalogContent({
  disabledNationalDexIds,
  error,
  loading,
  onRetry,
  onSelect,
  result,
  selectedPokemon,
}: CatalogContentProps) {
  if (loading && result === null) {
    return (
      <div className="pokemon-catalog-state" role="status">
        <LoaderCircle
          aria-hidden="true"
          className="spin-icon"
          size={27}
        />
        전국도감을 불러오고 있어요.
      </div>
    );
  }
  if (error) {
    return (
      <div className="pokemon-catalog-state" role="alert">
        <p>{error}</p>
        <button onClick={onRetry} type="button">
          다시 시도
        </button>
      </div>
    );
  }
  if (!result || result.content.length === 0) {
    return (
      <div className="pokemon-catalog-state">
        <Search aria-hidden="true" size={30} />
        <strong>검색 결과가 없어요</strong>
        <p>다른 이름이나 도감 번호로 검색해 주세요.</p>
      </div>
    );
  }
  return (
    <div
      aria-busy={loading}
      className="pokemon-card-grid"
    >
      {result.content.map((pokemon) => {
        const disabled = disabledNationalDexIds.has(
          pokemon.nationalDexId,
        );
        const selected =
          selectedPokemon?.nationalDexId ===
          pokemon.nationalDexId;
        return (
          <button
            aria-pressed={selected}
            className={`pokemon-card ${
              selected ? "is-selected" : ""
            }`}
            disabled={disabled}
            key={pokemon.nationalDexId}
            onClick={() => {
              onSelect(pokemon);
            }}
            type="button"
          >
            <PokemonArtwork pokemon={pokemon} />
            <span>{formatNationalDexId(pokemon.nationalDexId)}</span>
            <strong>{pokemon.koreanName}</strong>
            <PokemonTypeBadges types={pokemon.types} />
            {disabled ? (
              <span className="pokemon-card-status">
                이미 추측함
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function toSafeDetail(error: unknown): string {
  return error instanceof ApiError
    ? error.detail
    : "전국도감을 불러오지 못했습니다. 다시 시도해 주세요.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

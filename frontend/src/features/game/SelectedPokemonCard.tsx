import {
  BookOpen,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  PokemonArtwork,
  formatNationalDexId,
} from "../pokemon/PokemonArtwork";
import { PokemonTypeBadges } from "../pokemon/PokemonTypeBadges";
import type { PokemonEvolutionGateway } from "../pokemon/pokemonApi";
import type {
  PokemonEvolutionDetails,
  PokemonSummary,
} from "../pokemon/pokemonTypes";

interface SelectedPokemonCardProps {
  evolutionGateway: PokemonEvolutionGateway;
  onOpenPokedex(): void;
  paused: boolean;
  pokemon: PokemonSummary;
}

type EvolutionState =
  | {
      nationalDexId: number;
      status: "loading";
    }
  | {
      details: PokemonEvolutionDetails;
      nationalDexId: number;
      status: "success";
    }
  | {
      nationalDexId: number;
      status: "error";
    };

export function SelectedPokemonCard({
  evolutionGateway,
  onOpenPokedex,
  paused,
  pokemon,
}: SelectedPokemonCardProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const [evolutionState, setEvolutionState] =
    useState<EvolutionState>({
      nationalDexId: pokemon.nationalDexId,
      status: "loading",
    });

  useEffect(() => {
    const abortController = new AbortController();
    const nationalDexId = pokemon.nationalDexId;
    setEvolutionState({
      nationalDexId,
      status: "loading",
    });

    void evolutionGateway
      .findEvolutionDetails(
        nationalDexId,
        abortController.signal,
      )
      .then((details) => {
        if (!abortController.signal.aborted) {
          setEvolutionState({
            details,
            nationalDexId,
            status: "success",
          });
        }
      })
      .catch((error: unknown) => {
        if (
          !abortController.signal.aborted &&
          !isAbortError(error)
        ) {
          setEvolutionState({
            nationalDexId,
            status: "error",
          });
        }
      });

    return () => {
      abortController.abort();
    };
  }, [
    evolutionGateway,
    pokemon.nationalDexId,
    reloadKey,
  ]);

  const currentEvolutionState =
    evolutionState.nationalDexId === pokemon.nationalDexId
      ? evolutionState
      : {
          nationalDexId: pokemon.nationalDexId,
          status: "loading" as const,
        };

  return (
    <section className="secret-pokemon-card panel-card">
      <p className="role-pill selector-pill">
        내 역할 · 출제자
      </p>
      <span className="secret-pokemon-label">
        내가 선택한 포켓몬
      </span>
      <div className="secret-pokemon-summary">
        <PokemonArtwork pokemon={pokemon} />
        <div>
          <h2>
            {formatNationalDexId(pokemon.nationalDexId)}{" "}
            {pokemon.koreanName}
          </h2>
          <span className="pokemon-generation-badge">
            {pokemon.generation}세대
          </span>
          <PokemonTypeBadges types={pokemon.types} />
        </div>
      </div>
      <p className="secret-copy">
        <LockKeyhole aria-hidden="true" size={16} />
        정답은 상대에게 비공개
      </p>
      <button
        className="secondary-game-button secret-pokedex-button"
        disabled={paused}
        onClick={onOpenPokedex}
        type="button"
      >
        <BookOpen aria-hidden="true" size={18} />
        전국도감 보기
      </button>
      <EvolutionDetails
        onRetry={() => {
          setReloadKey((current) => current + 1);
        }}
        state={currentEvolutionState}
      />
    </section>
  );
}

function EvolutionDetails({
  onRetry,
  state,
}: {
  onRetry(): void;
  state: EvolutionState;
}) {
  if (state.status === "loading") {
    return (
      <div
        className="pokemon-evolution-status"
        role="status"
      >
        <LoaderCircle
          aria-hidden="true"
          className="spin-icon"
          size={18}
        />
        진화 정보를 불러오는 중이에요.
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="pokemon-evolution-status is-error">
        <p>진화 정보를 불러오지 못했어요.</p>
        <button
          aria-label="진화 정보 다시 불러오기"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={15} />
          다시 시도
        </button>
      </div>
    );
  }

  const { nextEvolutions, previousEvolution } =
    state.details;
  if (
    previousEvolution === null &&
    nextEvolutions.length === 0
  ) {
    return (
      <section className="pokemon-evolution-panel">
        <h3>진화 정보</h3>
        <p>직접 연결된 진화 포켓몬이 없어요.</p>
      </section>
    );
  }

  return (
    <section className="pokemon-evolution-panel">
      <h3>진화 정보</h3>
      <div className="pokemon-evolution-groups">
        <EvolutionGroup
          label="진화 전"
          pokemon={
            previousEvolution ? [previousEvolution] : []
          }
        />
        <EvolutionGroup
          label="진화 후"
          pokemon={nextEvolutions}
        />
      </div>
    </section>
  );
}

function EvolutionGroup({
  label,
  pokemon,
}: {
  label: string;
  pokemon: readonly PokemonSummary[];
}) {
  return (
    <div className="pokemon-evolution-group">
      <span>{label}</span>
      {pokemon.length === 0 ? (
        <p>없음</p>
      ) : (
        <div className="pokemon-evolution-list">
          {pokemon.map((candidate) => (
            <article
              className="pokemon-evolution-species"
              key={candidate.nationalDexId}
            >
              <PokemonArtwork pokemon={candidate} />
              <div>
                <span>
                  {formatNationalDexId(
                    candidate.nationalDexId,
                  )}
                </span>
                <strong>{candidate.koreanName}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

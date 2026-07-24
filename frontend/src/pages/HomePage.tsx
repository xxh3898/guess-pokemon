import { CircleHelp, Gamepad2, History, Sparkles } from "lucide-react";

export function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card" aria-labelledby="service-title">
        <div className="brand-mark" aria-hidden="true">
          <CircleHelp size={34} strokeWidth={2.2} />
        </div>

        <p className="eyebrow">
          <Sparkles size={16} aria-hidden="true" />
          실시간 1:1 포켓몬 스무고개
        </p>

        <h1 id="service-title">Guess Pokémon</h1>
        <p className="hero-copy">
          한 명이 정답 포켓몬을 고르면 다른 한 명이 질문과 추측으로
          정답을 찾아갑니다.
        </p>

        <div className="feature-grid" aria-label="주요 기능">
          <article className="feature-card">
            <Gamepad2 size={24} aria-hidden="true" />
            <h2>실시간 대결</h2>
            <p>방 코드로 만나 같은 경기 상태를 보며 번갈아 진행합니다.</p>
          </article>

          <article className="feature-card">
            <CircleHelp size={24} aria-hidden="true" />
            <h2>20번의 기회</h2>
            <p>질문과 포켓몬 추측을 합쳐 스무 번 안에 정답을 찾습니다.</p>
          </article>

          <article className="feature-card">
            <History size={24} aria-hidden="true" />
            <h2>경기 기록</h2>
            <p>역할과 승패, 질문·답변·추측 흐름을 나중에 다시 봅니다.</p>
          </article>
        </div>

        <p className="phase-note">현재 기본 실행 골격을 준비하고 있습니다.</p>
      </section>
    </main>
  );
}

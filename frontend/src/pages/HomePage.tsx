import {
  ArrowRight,
  CircleHelp,
  Clock3,
  Gamepad2,
  History,
  LogIn,
  Play,
  RefreshCw,
  Search,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "../features/auth/AuthContext";

export function HomePage() {
  const auth = useAuth();

  return (
    <main className="site-page landing-page">
      <div className="site-frame landing-frame">
        <header className="site-header">
          <Link className="brand-link" to="/">
            <span className="brand-link-mark" aria-hidden="true">
              <CircleHelp size={24} strokeWidth={2.4} />
            </span>
            Guess Pokémon
          </Link>

          <nav aria-label="계정 메뉴" className="header-nav">
            {auth.status === "anonymous" ? (
              <>
                <Link className="header-text-link" to="/login">
                  <LogIn aria-hidden="true" size={17} />
                  로그인
                </Link>
                <Link className="header-primary-link" to="/signup">
                  <UserPlus aria-hidden="true" size={17} />
                  회원가입
                </Link>
              </>
            ) : null}
            {auth.status === "authenticated" ? (
              <Link className="header-primary-link" to="/lobby">
                대전 로비
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
            ) : null}
          </nav>
        </header>

        <section className="landing-hero" aria-labelledby="service-title">
          <div className="landing-hero-copy">
            <p className="section-kicker">실시간 1:1 포켓몬 스무고개</p>
            <h1 id="service-title">
              질문으로 찾아내는 <span className="no-wrap">포켓몬</span>
            </h1>
            <p className="hero-copy">
              친구와 같은 방에서 질문을 주고받으며 스무 번 안에
              정답 포켓몬을 찾아보세요.
            </p>

            <div className="hero-actions">
              {auth.status === "authenticated" ? (
                <Link className="primary-link" to="/lobby">
                  <UsersRound aria-hidden="true" size={20} />
                  대전 로비로
                </Link>
              ) : null}
              {auth.status === "anonymous" ? (
                <Link className="primary-link" to="/login">
                  <Play aria-hidden="true" size={20} />
                  대전 시작하기
                </Link>
              ) : null}
              {auth.status === "loading" ? (
                <p aria-live="polite" className="session-note">
                  로그인 상태를 확인하고 있어요.
                </p>
              ) : null}
              {auth.status === "error" ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    void auth.restoreSession();
                  }}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={18} />
                  다시 확인
                </button>
              ) : null}
              <a className="secondary-link" href="#game-guide">
                <CircleHelp aria-hidden="true" size={20} />
                게임 방법
              </a>
            </div>
          </div>

          <div className="mystery-stage" aria-hidden="true">
            <span className="mystery-stage-label">WHO&apos;S THAT?</span>
            <div className="mystery-halo" />
            <CircleHelp className="mystery-stage-icon" size={164} />
            <span className="mystery-stage-number">No. 025</span>
          </div>
        </section>

        <section
          aria-label="게임 진행 순서"
          className="game-steps"
          id="game-guide"
        >
          <article className="step-card">
            <span className="step-number">01</span>
            <UsersRound aria-hidden="true" size={34} />
            <div>
              <h2>방 만들기</h2>
              <p>친구와 공유할 방을 준비해요.</p>
            </div>
          </article>

          <article className="step-card">
            <span className="step-number mint-number">02</span>
            <Search aria-hidden="true" size={34} />
            <div>
              <h2>포켓몬 선택</h2>
              <p>출제자가 정답 한 마리를 골라요.</p>
            </div>
          </article>

          <article className="step-card">
            <span className="step-number yellow-number">03</span>
            <CircleHelp aria-hidden="true" size={34} />
            <div>
              <h2>질문과 추측</h2>
              <p>질문을 좁혀 정답을 맞혀요.</p>
            </div>
          </article>
        </section>

        <ul className="rule-strip" aria-label="핵심 게임 규칙">
          <li>
            <Gamepad2 aria-hidden="true" size={24} />
            <strong>20번의 기회</strong>
          </li>
          <li>
            <RefreshCw aria-hidden="true" size={24} />
            <strong>60초 재접속</strong>
          </li>
          <li>
            <History aria-hidden="true" size={24} />
            <strong>경기 기록</strong>
          </li>
          <li className="rule-strip-detail">
            <Clock3 aria-hidden="true" size={18} />
            질문부터 결과까지 실시간으로 함께 진행해요.
          </li>
        </ul>
      </div>
    </main>
  );
}

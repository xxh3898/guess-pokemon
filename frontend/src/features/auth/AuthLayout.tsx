import type { ReactNode } from "react";
import {
  CircleHelp,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";

interface AuthLayoutProps {
  children: ReactNode;
  description: string;
  eyebrow: string;
  footer: ReactNode;
  headerActionLabel: string;
  headerActionTo: string;
  title: string;
  variant: "login" | "signup";
}

export function AuthLayout({
  children,
  description,
  eyebrow,
  footer,
  headerActionLabel,
  headerActionTo,
  title,
  variant,
}: AuthLayoutProps) {
  return (
    <main className={`auth-page auth-page-${variant}`}>
      <div className="site-frame auth-frame">
        <header className="site-header auth-header">
          <Link
            aria-label="Guess Pokémon 처음 화면"
            className="brand-link"
            to="/"
          >
            <span className="brand-link-mark" aria-hidden="true">
              <CircleHelp size={24} strokeWidth={2.4} />
            </span>
            Guess Pokémon
          </Link>

          <Link className="header-text-link" to={headerActionTo}>
            {headerActionLabel}
          </Link>
        </header>

        <div className="auth-panel">
          <section className="auth-intro" aria-labelledby="auth-intro-title">
            <div className="auth-copy">
              <p className="section-kicker">
                <Sparkles aria-hidden="true" size={15} />
                {eyebrow}
              </p>
              <h2 id="auth-intro-title">{title}</h2>
              <p>{description}</p>
            </div>

            <div className="mystery-card auth-mystery-card" aria-hidden="true">
              <div className="mystery-grid" />
              <ScanSearch className="mystery-search" size={58} />
              <CircleHelp className="mystery-question" size={116} />
              <span className="mystery-number">025</span>
            </div>
          </section>

          <section className="auth-card">
            {children}
            <div className="auth-footer">{footer}</div>
          </section>
        </div>
      </div>
    </main>
  );
}

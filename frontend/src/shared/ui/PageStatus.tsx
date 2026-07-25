import {
  CircleHelp,
  LoaderCircle,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { Link } from "react-router";

interface PageStatusProps {
  backLink?: {
    label: string;
    to: string;
  };
  detail: string;
  loading?: boolean;
  onRetry?: () => void;
  title: string;
}

export function PageStatus({
  backLink,
  detail,
  loading = false,
  onRetry,
  title,
}: PageStatusProps) {
  const Icon = loading ? LoaderCircle : WifiOff;
  return (
    <main className="site-page status-page">
      <div className="site-frame status-frame">
        <header className="site-header">
          <Link className="brand-link" to="/">
            <span className="brand-link-mark" aria-hidden="true">
              <CircleHelp size={24} strokeWidth={2.4} />
            </span>
            Guess Pokémon
          </Link>
        </header>

        <section
          aria-live="polite"
          className="status-card"
          role={loading ? "status" : "alert"}
        >
          <span
            className={`status-icon ${
              loading ? "blue-status-icon" : "coral-status-icon"
            }`}
            aria-hidden="true"
          >
            <Icon
              className={loading ? "spin-icon" : undefined}
              size={34}
            />
          </span>
          <p className="section-kicker">
            {loading ? "불러오는 중" : "연결 확인"}
          </p>
          <h1>{title}</h1>
          <p>{detail}</p>
          {onRetry || backLink ? (
            <div className="status-actions">
              {onRetry ? (
                <button
                  className="primary-button compact-button"
                  onClick={onRetry}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={18} />
                  다시 시도
                </button>
              ) : null}
              {backLink ? (
                <Link
                  className="secondary-link compact-link"
                  to={backLink.to}
                >
                  {backLink.label}
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

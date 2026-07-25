import {
  CircleHelp,
  Gamepad2,
  Home,
  MapPinOff,
} from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "../features/auth/AuthContext";

export function NotFoundPage() {
  const auth = useAuth();
  const destination =
    auth.status === "authenticated" ? "/lobby" : "/";
  const linkLabel =
    auth.status === "authenticated"
      ? "대전 로비로"
      : "처음 화면으로";

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

        <section className="status-card" aria-labelledby="not-found-title">
          <span className="status-code">404</span>
          <span className="status-icon coral-status-icon" aria-hidden="true">
            <MapPinOff size={34} />
          </span>
          <h1 id="not-found-title">페이지를 찾을 수 없어요</h1>
          <p>주소가 잘못됐거나 페이지가 다른 곳으로 이동했을 수 있어요.</p>
          <Link className="primary-link compact-link" to={destination}>
            {auth.status === "authenticated" ? (
              <Gamepad2 aria-hidden="true" size={18} />
            ) : (
              <Home aria-hidden="true" size={18} />
            )}
            {linkLabel}
          </Link>
        </section>
      </div>
    </main>
  );
}

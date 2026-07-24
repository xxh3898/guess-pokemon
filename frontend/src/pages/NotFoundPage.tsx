import { ArrowLeft, MapPinOff } from "lucide-react";
import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <main className="page-shell">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <MapPinOff size={36} aria-hidden="true" />
        <p className="eyebrow">404</p>
        <h1 id="not-found-title">페이지를 찾을 수 없어요</h1>
        <p>주소를 다시 확인하거나 처음 화면으로 돌아가 주세요.</p>
        <Link className="home-link" to="/">
          <ArrowLeft size={18} aria-hidden="true" />
          처음으로 돌아가기
        </Link>
      </section>
    </main>
  );
}

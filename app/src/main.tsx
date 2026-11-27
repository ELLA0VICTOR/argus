import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import "./index.css";
import Landing from "./landing/Landing";

// The app and demo are split out so the landing page loads fast.
const AppRoot = lazy(() => import("./app/AppRoot"));
const DemoPage = lazy(() => import("./demo/DemoPage"));
const PhonePage = lazy(() => import("./demo/PhonePage"));

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function Loading() {
  return <div className="min-h-screen bg-ink" />;
}

/** Hands off from the HTML splash once the intro has played (~3.5s after navigation). */
function dismissSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The owner's-phone page skips the intro: it has to be ready to ring.
  const quick = reduce || location.pathname.startsWith("/demo/phone/");
  const wait = Math.max(0, (quick ? 300 : 3500) - performance.now());
  setTimeout(() => {
    el.classList.add("out");
    document.documentElement.classList.remove("intro");
    setTimeout(() => el.remove(), 560);
  }, wait);
}
requestAnimationFrame(dismissSplash);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app/*" element={<AppRoot />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/demo/phone/:session" element={<PhonePage />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);

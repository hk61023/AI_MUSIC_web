import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { usePlayer } from "./player";
export default function VisitTracker() {
  const { pathname } = useLocation(),
    { playing } = usePlayer();
  const state = useRef({
    id: crypto.randomUUID(),
    duration: 0,
    last: performance.now(),
    active: false,
    path: pathname,
    playing,
  });
  const send = useRef<(event: string) => void>(() => {});
  useEffect(() => {
    const s = state.current;
    const flush = (event: string) => {
      const now = performance.now();
      if (now - s.last > 1800000) {
        s.id = crypto.randomUUID();
        s.duration = 0;
        s.active = false;
      }
      if (s.active) s.duration += Math.min(now - s.last, 30000);
      s.last = now;
      s.active =
        !s.path.startsWith("/admin") &&
        (document.visibilityState === "visible" || s.playing);
      if (s.path.startsWith("/admin")) return;
      const body = JSON.stringify({
        id: s.id,
        duration: Math.round(s.duration),
        event,
        path: s.path,
      });
      void fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    };
    send.current = flush;
    const visibility = () => flush("heartbeat"),
      leave = () => flush("leave");
    const timer = setInterval(() => flush("heartbeat"), 15000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
    };
  }, []);
  useEffect(() => {
    if (state.current.path !== pathname) send.current("leave");
    state.current.path = pathname;
    send.current("page_view");
  }, [pathname]);
  useEffect(() => {
    if (state.current.playing !== playing) {
      state.current.playing = playing;
      send.current(playing ? "play" : "pause");
    }
  }, [playing]);
  return null;
}

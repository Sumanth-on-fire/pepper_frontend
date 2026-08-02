"use client";

import { useEffect } from "react";

const HEALTH_CHECK_INTERVAL_MS = 14 * 60 * 1000;
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const pingHealth = async () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    await fetch(`${API_BASE}/health`, {
      method: "GET",
      cache: "no-store",
    });
  } catch {
    // Keep the UI running silently even if the health endpoint is briefly unavailable.
  }
};

export function HealthKeepAlive() {
  useEffect(() => {
    void pingHealth();

    const intervalId = window.setInterval(() => {
      void pingHealth();
    }, HEALTH_CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pingHealth();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}

"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Avoid a hydration mismatch: the server can't know the persisted theme,
  // so render a stable placeholder until mounted on the client.
  const [mounted, setMounted] = useState(false);
  // Required hydration guard (next-themes can't know the persisted theme on
  // the server): the resulting extra render is intentional, not an effect misuse.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <Button size="icon" variant="ghost" className="h-8 w-8" aria-hidden tabIndex={-1} />;
  }

  const isDark = resolvedTheme === "dark";
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-8 w-8"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

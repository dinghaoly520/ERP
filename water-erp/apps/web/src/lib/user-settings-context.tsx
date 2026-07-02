"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { fetchUserSettings, updateUserSettings as apiUpdateSettings, type UserSettings } from "@/lib/api/user-settings";

type Theme = "light" | "dark" | "system";
type HomePage = "dashboard" | "procurements" | "projects" | "work-arrangements";

interface UserSettingsContextValue {
  settings: UserSettings | null;
  loading: boolean;
  error: string | null;
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  resolvedTheme: "light" | "dark";
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error("useUserSettings must be used within a UserSettingsProvider");
  }
  return context;
}

interface UserSettingsProviderProps {
  children: ReactNode;
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return getSystemTheme();
  }
  return theme;
}

export function UserSettingsProvider({ children }: UserSettingsProviderProps) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await fetchUserSettings();
        setSettings(result);
      } catch {
        setError("无法加载用户设置");
      } finally {
        setLoading(false);
      }
    };
    void loadSettings();
  }, []);

  // Apply theme when settings change
  useEffect(() => {
    if (!settings) return;

    const theme = settings.theme as Theme;
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);

    // Apply theme to HTML element
    const html = document.documentElement;
    html.classList.remove("light", "dark");
    html.classList.add(resolved);

    // Update CSS variables for theme
    if (resolved === "dark") {
      html.style.colorScheme = "dark";
    } else {
      html.style.colorScheme = "light";
    }
  }, [settings?.theme]);

  // Apply compact mode when settings change
  useEffect(() => {
    if (!settings) return;

    const html = document.documentElement;
    if (settings.compactMode) {
      html.classList.add("compact-mode");
    } else {
      html.classList.remove("compact-mode");
    }
  }, [settings?.compactMode]);

  // Listen for system theme changes
  useEffect(() => {
    if (settings?.theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const resolved = getSystemTheme();
      setResolvedTheme(resolved);
      const html = document.documentElement;
      html.classList.remove("light", "dark");
      html.classList.add(resolved);
      html.style.colorScheme = resolved;
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [settings?.theme]);

  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    if (!settings) return;

    try {
      const updated = await apiUpdateSettings(updates);
      setSettings(updated);
    } catch (err) {
      throw err;
    }
  }, [settings]);

  return (
    <UserSettingsContext.Provider
      value={{
        settings,
        loading,
        error,
        updateSettings,
        resolvedTheme,
      }}
    >
      {children}
    </UserSettingsContext.Provider>
  );
}

// Utility function to get default home page (can be called outside React components)
export async function getDefaultHomePage(): Promise<HomePage> {
  try {
    const settings = await fetchUserSettings();
    return settings.defaultHomePage as HomePage;
  } catch {
    return "dashboard";
  }
}

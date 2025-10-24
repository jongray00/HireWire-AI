import { useEffect } from 'react';
import { useThemeStore } from '../stores/theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;

    // Only update if the theme has changed
    if (!root.classList.contains(theme)) {
      // Remove both classes first
      root.classList.remove('light', 'dark');

      // Add the current theme class
      root.classList.add(theme);

      // Update the data-theme attribute for additional styling hooks
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  return <>{children}</>;
}

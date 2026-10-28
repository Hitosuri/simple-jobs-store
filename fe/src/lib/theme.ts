import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export type Theme = 'dark' | 'light';

export const themeAtom = atomWithStorage<Theme>('theme', 'dark');

export function useTheme() {
  const [theme, setTheme] = useAtom(themeAtom);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return [theme, setTheme] as const;
}

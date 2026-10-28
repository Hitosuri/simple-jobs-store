import { Moon, Sun } from 'lucide-react';
import { useAtom } from 'jotai';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { themeAtom } from '@/lib/theme';

export function ThemeToggle() {
  const [theme, setTheme] = useAtom(themeAtom);
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            aria-label={label}
            className="size-11 lg:size-8"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          />
        }
      >
        {theme === 'dark' ? <Sun /> : <Moon />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

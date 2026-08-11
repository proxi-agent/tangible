'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/tooltip';

type Theme = 'light' | 'dark' | 'system';

/**
 * Stamps `data-theme` on the root element, which the token layer keys off. The
 * 'system' setting removes the attribute so the OS preference applies.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem('tangible-theme') as Theme | null;
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    localStorage.setItem('tangible-theme', theme);
  }, [theme]);

  const options: { value: Theme; icon: typeof Sun; label: string; hint: string }[] = [
    { value: 'light', icon: Sun, label: 'Light', hint: 'Always use the light color scheme.' },
    { value: 'dark', icon: Moon, label: 'Dark', hint: 'Always use the dark color scheme.' },
    {
      value: 'system',
      icon: Monitor,
      label: 'System',
      hint: 'Follow whatever your computer is set to.',
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="flex items-center gap-0.5 rounded-md border border-[var(--color-hairline)] p-0.5"
    >
      {options.map(({ value, icon: Icon, label, hint }) => (
        <Tooltip key={value} title={label} content={hint}>
          <button
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              'cursor-pointer rounded p-1.5 transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
              theme === value
                ? 'bg-[var(--color-plane)] text-[var(--color-ink)] ring-1 ring-[var(--color-hairline)]'
                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-plane)] hover:text-[var(--color-ink)]',
            )}
          >
            <Icon size={14} strokeWidth={2} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Segmented } from '@/components/ui/controls';

type Theme = 'light' | 'dark' | 'system';

/**
 * Stamps `data-theme` on the root element, which the token layer keys off. The
 * 'system' setting removes the attribute so the OS preference applies.
 *
 * Rendered as one connected switch rather than three loose buttons: three
 * states of a single setting should look like a single control, and in the
 * sidebar footer there is no room for a label beside each icon.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem('tangible-theme') as Theme | null;
    // localStorage does not exist on the server, so the stored theme can only
    // be adopted after hydration. Initializing the state from it directly would
    // render one toggle on the server and a different one in the browser.
    // oxlint-disable-next-line react/set-state-in-effect
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    localStorage.setItem('tangible-theme', theme);
  }, [theme]);

  return (
    <Segmented<Theme>
      ariaLabel="Color theme"
      value={theme}
      onChange={setTheme}
      grow
      className="w-full"
      options={[
        {
          value: 'light',
          title: 'Always use the light color scheme',
          label: (
            <>
              <Sun size={13} strokeWidth={2} />
              <span className="sr-only">Light</span>
            </>
          ),
        },
        {
          value: 'dark',
          title: 'Always use the dark color scheme',
          label: (
            <>
              <Moon size={13} strokeWidth={2} />
              <span className="sr-only">Dark</span>
            </>
          ),
        },
        {
          value: 'system',
          title: 'Follow whatever your computer is set to',
          label: (
            <>
              <Monitor size={13} strokeWidth={2} />
              <span className="sr-only">System</span>
            </>
          ),
        },
      ]}
    />
  );
}

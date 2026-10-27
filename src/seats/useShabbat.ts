import React from 'react';
import { loadShabbat } from '../api.ts';
import { fixtureShabbat } from '../client/fixtures.ts';
import { config } from '../config.ts';
import { civilDate } from '../dates.ts';
import { shabbatFriday } from './window.ts';

/** The coming Shabbat for the seat screens: its Friday, its Saturday (Hebrew date) and the parasha once known. */
export function useShabbat(): { friday: string; saturday: string; parasha: string | null } {
  const [parasha, setParasha] = React.useState<string | null>(null);
  const friday = shabbatFriday(new Date());
  const saturday = new Date(civilDate(friday).getTime() + 86400000).toISOString().slice(0, 10);
  React.useEffect(() => {
    let live = true;
    (config.fixtures ? Promise.resolve(fixtureShabbat(friday)) : loadShabbat(friday)).then(s => { if (live) setParasha(s.parasha); }, () => {});
    return () => { live = false; };
  }, [friday]);
  return { friday, saturday, parasha };
}

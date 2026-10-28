// Family-tree model (UX-DESIGN §17.5). Pure data: names and dates are computed from it, never stored twice.
export type Relation = 'self' | 'spouse' | 'father' | 'mother' | 'child' | 'childSpouse' | 'grandchild' | 'formerSpouse';
// Same keys as server MONTH_NUMBERS (server/hebrew_calendar.py). adar_i/adar_ii only in leap years, adar only in regular years.
export type MonthKey = 'nisan' | 'iyar' | 'sivan' | 'tamuz' | 'av' | 'elul' | 'tishrei' | 'cheshvan' | 'kislev' | 'tevet' | 'shevat' | 'adar' | 'adar_i' | 'adar_ii';
export type HebDate = { day: number; month: MonthKey; year?: number };
export type Tribe = 'kohen' | 'levi' | 'yisrael';
export type FigureOptions = { headCovering?: 'tichel' | 'hat' | 'wig' | 'none'; coverColor?: string; kippah?: 'knitted' | 'small' | 'velvet' | 'none'; beard?: 'none' | 'short' | 'full'; glasses?: boolean; skin?: 0 | 1 | 2; hair?: string };
export type Person = {
  id: string;
  userId?: string; // server-managed link to an account; read-only on the client
  relation: Relation;
  // father/mother: the person whose parent this is. spouse and formerSpouse: the self id (a former spouse is names only). childSpouse and grandchild: the child's id.
  of?: string;
  gender: 'm' | 'f';
  hebrewFirst?: string; surname?: string; fatherName?: string; motherName?: string;
  tribe?: Tribe; birth?: HebDate; deceased?: boolean; ill?: boolean; /* living only */ death?: HebDate;
  barMitzvah?: { date: string; parasha: string; manual: boolean; label?: string };
  figure?: FigureOptions;
};
export type PersonName = { text: string; missing: ('father' | 'mother' | 'first')[] };

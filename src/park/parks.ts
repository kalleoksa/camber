import { layoutFromSlope, type Layout } from './layout.ts';
import { PARK } from './park.ts';
import { SLOPESTYLE } from './slopestyle.ts';
import { SOCHI } from './sochi.ts';

const DOWN = Math.PI; // nose down the fall line (-Z)

/** The old home park, the fallback: starts lined up in the jump line, straight at the first kicker. */
export const HOME: Layout = layoutFromSlope('home', PARK, { x: PARK.kickers?.[0]?.x ?? 0, z: 0, heading: DOWN });

/** The hand-built parks as layouts, by the name ?park= takes. */
export const PARKS: Record<string, Layout> = {
  home: HOME,
  slopestyle: layoutFromSlope('slopestyle', SLOPESTYLE, { x: 0, z: 0, heading: DOWN }),
  sochi: layoutFromSlope('sochi', SOCHI, { x: 0, z: 0, heading: DOWN }),
};

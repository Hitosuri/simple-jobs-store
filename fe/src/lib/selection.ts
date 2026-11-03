import { atom } from 'jotai';

export const selectedJobIdsAtom = atom(new Set<number>());

/** Job ids in the order the Jobs list currently shows them; the detail panel steps through it. */
export const visibleJobIdsAtom = atom<number[]>([]);

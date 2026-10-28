import { atom } from 'jotai';

export const selectedJobIdsAtom = atom(new Set<number>());

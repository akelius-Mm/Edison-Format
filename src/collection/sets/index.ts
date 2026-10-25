// Every era product the collection knows, in release order.
import type { EraSetData, StructureDeckData } from '../types';
import { ABPF } from './abpf';
import { ANPR } from './anpr';
import { CRMS } from './crms';
import { CSOC } from './csoc';
import { GLAS } from './glas';
import { GLD1 } from './gld1';
import { GLD2 } from './gld2';
import { GLD3 } from './gld3';
import { HA01 } from './ha01';
import { LODT } from './lodt';
import { PTDN } from './ptdn';
import { RGBT } from './rgbt';
import { SOVR } from './sovr';
import { TDGS } from './tdgs';
import { TSHD } from './tshd';
import { TU01 } from './tu01';
import { TU02 } from './tu02';
import { TU03 } from './tu03';
import { SDMM, SDSC, SDWS, SDZW } from './structure';

/** Booster products (core sets, Hidden Arsenal, Turbo Packs, Gold Series). */
export const ERA_SETS: EraSetData[] = [GLAS, PTDN, GLD1, LODT, TDGS, CSOC, CRMS, GLD2, RGBT, ANPR, TU01, HA01, SOVR, TU02, ABPF, TSHD, GLD3, TU03];

export const STRUCTURE_DECKS: StructureDeckData[] = [SDZW, SDSC, SDWS, SDMM];

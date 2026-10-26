// Loads every card definition (side-effect imports) and applies the banlist.
import './sets/core';
import './sets/spells';
import './sets/traps';
import './sets/monsters';
import './sets/extra';
import './sets/plants';
import './sets/zombies';
import './sets/lightsworn';
import './sets/blackwings';
import './sets/sabers';
import './sets/gladiators';
import './sets/monarchs';
import './sets/teledad';
import './sets/heroes';
import './sets/tournament-extras';
import './sets/ha01';
import './sets/anpr';
import './sets/sovr';
import './sets/abpf';
import './sets/tournament-extras2';
import './sets/rgbt';
import './sets/crms';
import './sets/ptdn';
import './sets/lodt';
import './sets/glas';
import './sets/csoc';
import './sets/tdgs';
import './sets/archetype-extras';
import './sets/archetype-extras2';
import './sets/sdmm';
import './sets/deck-extras3';
import './gy-costs';
import './why-not';
import { applyBanlist } from './banlist';

applyBanlist();

export { CARDS, allCards, cardByName, findCard } from './define';

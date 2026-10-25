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
import { applyBanlist } from './banlist';

applyBanlist();

export { CARDS, allCards, cardByName, findCard } from './define';

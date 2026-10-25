# Card allocation (who defines what)

Each card is defined in exactly ONE file. Defining a card that belongs to another file throws
"Duplicate card definition" at load time. Decks may reference any card on this list.
Exact official English names are used as keys (case-sensitive in deck lists).

## Already done — `src/cards/sets/core.ts`
Mystical Space Typhoon, Heavy Storm, Dark Hole, Monster Reborn, Pot of Avarice, Book of Moon,
Brain Control, Limiter Removal, Scapegoat (+ Sheep Token), Mirror Force, Bottomless Trap Hole,
Solemn Judgment, Call of the Haunted, Royal Oppression, Gravity Bind, Sangan, Card Trooper,
Cyber Dragon, Dark Armed Dragon, Morphing Jar, Treeborn Frog, Honest, Goyo Guardian,
Brionac, Dragon of the Ice Barrier

## `spells.ts` — generic Spells
Allure of Darkness, Gold Sarcophagus, Smashing Ground, Lightning Vortex, Swords of Revealing Light,
Premature Burial, Burial from a Different Dimension, Mind Control, Enemy Controller, Shrink,
Foolish Burial, Reinforcement of the Army, Cold Wave, Card Destruction, Messenger of Peace,
Nobleman of Crossout, Monster Reincarnation, Polymerization, Soul Exchange, Upstart Goblin,
Megamorph, Axe of Despair, United We Stand, Mage Power, Fissure, Shield Crush,
Magical Stone Excavation, Monster Gate, Hand Destruction, Reasoning, Double Summon, Mass Driver,
Level Limit - Area B, Trade-In, Dian Keto the Cure Master, Ookazi, Hinotama, Rush Recklessly,
Emergency Provisions, Spell Reproduction, Magic Planter, The Forceful Sentry (F), Metamorphosis (F),
Pot of Greed (F), Graceful Charity (F), Change of Heart (F), Snatch Steal (F), Raigeki (F),
Harpie's Feather Duster (F), Giant Trunade (F), Painful Choice (F), Delinquent Duo (F),
Card of Safe Return (F), Mirage of Nightmare (F), Butterfly Dagger - Elma (F),
Dimension Fusion (F), Future Fusion, Overload Fusion (only if feasible)

## `traps.ts` — generic Traps
Torrential Tribute, Solemn Warning, Dimensional Prison, Trap Dustshoot, Magic Cylinder,
Sakuretsu Armor, Compulsory Evacuation Device, Phoenix Wing Wind Blast, Starlight Road,
Trap Stun, Seven Tools of the Bandit, Divine Wrath, Royal Decree, Mind Crush, Dust Tornado,
Raigeki Break, Threatening Roar, Negate Attack, Ultimate Offering, Ceasefire, Skill Drain,
Macro Cosmos, Trap Hole, Magic Drain, Dark Bribe, Horn of Heaven, Ojama Trio (+ Ojama Token),
Waboku, Return from the Different Dimension, Wall of Revealing Light, Michizure, Widespread Ruin,
Karma Cut, Reckless Greed, Magical Explosion, Shadow Spell, Spellbinding Circle,
Draining Shield, Dimension Wall, Bad Reaction to Simochi, Time Seal (F), Imperial Order (F),
Last Turn (F), Ring of Destruction (F), Crush Card Virus (F), Exchange of the Spirit (F)

## `monsters.ts` — generic Main Deck monsters (effect + vanilla)
Spirit Reaper, Mystic Tomato, Necro Gardna, Gorz the Emissary of Darkness (+ Emissary of Darkness Token),
Tragoedia, Battle Fader, Marshmallon, Breaker the Magical Warrior, Exiled Force,
D.D. Warrior Lady, Snipe Hunter, Chaos Sorcerer, Jinzo, Rescue Cat, Marauding Captain,
Night Assailant, Magician of Faith, Neo-Spacian Grand Mole, Twin-Headed Behemoth,
Banisher of the Radiance, Doomcaliber Knight, D.D. Assailant, Thunder King Rai-Oh,
Tribe-Infecting Virus, Tsukuyomi, Kycoo the Ghost Destroyer, Giant Rat, Mother Grizzly,
Shining Angel, Big Shield Gardna, Cyber Valley, Gravekeeper's Spy, Genex Controller,
Dark Resonator, Cyber Phoenix, Mystic Swordsman LV2,
Black Luster Soldier - Envoy of the Beginning (F), Chaos Emperor Dragon - Envoy of the End (F),
Dark Magician of Chaos (F), Sinister Serpent (F), Witch of the Black Forest (F), Cyber Jar (F),
Fiber Jar (F), Magical Scientist (F), Sacred Phoenix of Nephthys (F), Victory Dragon (F),
Yata-Garasu (F), Makyura the Destructor (F), Cyber-Stein (F)
Vanilla: Blue-Eyes White Dragon, Dark Magician, Summoned Skull, Gemini Elf, Vorse Raider,
Gene-Warped Warwolf, Luster Dragon, Alexandrite Dragon, Mad Dog of Darkness, Frostosaurus,
Giant Soldier of Stone, Neo Bug, Archfiend Soldier, Battle Ox, La Jinn the Mystical Genie of the Lamp,
Mechanicalchaser, Luster Dragon #2, Red-Eyes B. Dragon, Celtic Guardian, Insect Knight,
Sea Serpent Warrior of Darkness, Totem Dragon, 7 Colored Fish

## `extra.ts` — generic Extra Deck
Stardust Dragon, Black Rose Dragon, Red Dragon Archfiend, Colossal Fighter, Thought Ruler Archfiend,
Ancient Fairy Dragon, Arcanite Magician, Magical Android, Mist Wurm, Nitro Warrior, Power Tool Dragon,
Armory Arm, Ally of Justice Catastor, Junk Warrior, Junk Destroyer, Turbo Warrior, Iron Chain Dragon,
Ancient Sacred Wyvern, Gaia Knight, the Force of Earth, Exploder Dragonwing, Avenging Knight Parshath,
Dewloren, Tiger King of the Ice Barrier, Explosive Magician, Dark Strike Fighter (F),
Thousand-Eyes Restrict (F), Cyber Twin Dragon, Cyber End Dragon, Chimeratech Overdragon,
Dark Balter the Terrible, Goyo Guardian & Brionac are in core.

## Archetype group A — `plants.ts`, `zombies.ts`, `lightsworn.ts`, decks in `src/decks/group-a.ts`
plants.ts: Quickdraw Synchron, Dandylion (+ Fluff Token), Lonefire Blossom, Debris Dragon,
Level Eater, Junk Synchron, Tytannial, Princess of Camellias, Gigaplant, Nettles, Copy Plant
(Spore, Glow-Up Bulb and One for One are NOT Edison-legal — do not define)
zombies.ts: Zombie Master, Goblin Zombie, Mezuki, Plaguespreader Zombie, Pyramid Turtle,
Book of Life, Il Blud, Red-Eyes Zombie Dragon, Doomkaiser Dragon, Zombie World, Vampire Lord,
Ryu Kokki, Despair from the Dark
lightsworn.ts: Ryko, Lightsworn Hunter; Lumina, Lightsworn Summoner; Wulf, Lightsworn Beast;
Jain, Lightsworn Paladin; Garoth, Lightsworn Warrior; Ehren, Lightsworn Monk;
Celestia, Lightsworn Angel; Lyla, Lightsworn Sorceress; Aurkus, Lightsworn Druid;
Judgment Dragon; Charge of the Light Brigade; Solar Recharge; Lightsworn Sabre; Realm of Light

## Archetype group B — `blackwings.ts`, `sabers.ts`, `gladiators.ts`, decks in `src/decks/group-b.ts`
blackwings.ts: Blackwing - Kalut the Moon Shadow, Blackwing - Shura the Blue Flame,
Blackwing - Bora the Spear, Blackwing - Sirocco the Dawn, Blackwing - Gale the Whirlwind,
Blackwing - Blizzard the Far North, Blackwing - Elphin the Raven, Blackwing - Fane the Steel Chain,
Blackwing - Mistral the Silver Shield, Black Whirlwind, Icarus Attack, Delta Crow - Anti Reverse,
Blackwing - Armor Master, Blackwing Armed Wing, Blackwing - Silverwind the Ascendant
sabers.ts: X-Saber Airbellum, XX-Saber Faultroll, XX-Saber Boggart Knight, XX-Saber Darksoul,
X-Saber Galahad, X-Saber Pashuul, X-Saber Anu Piranha, X-Saber Palomuro, X-Saber Uruz,
Gottoms' Emergency Call, Saber Slash, XX-Saber Gottoms, XX-Saber Hyunlei
gladiators.ts: Gladiator Beast Bestiari, Gladiator Beast Darius, Gladiator Beast Laquari,
Gladiator Beast Murmillo, Gladiator Beast Hoplomus, Gladiator Beast Equeste, Gladiator Beast Retiari,
Gladiator Beast Secutor, Gladiator Beast Andal, Test Tiger,
Gladiator Beast War Chariot, Gladiator Proving Ground, Gladiator Beast's Respite,
Gladiator Beast Gyzarus, Gladiator Beast Heraklinos

## Archetype group C — `monarchs.ts`, `teledad.ts`, `heroes.ts`, decks in `src/decks/group-c.ts`
monarchs.ts: Caius the Shadow Monarch, Raiza the Storm Monarch, Mobius the Frost Monarch,
Thestalos the Firestorm Monarch, Zaborg the Thunder Monarch, Granmarg the Rock Monarch,
Swap Frog, Substitoad, Ronintoadin, Dupe Frog, Flip Flop Frog, Frog the Jam, Des Frog,
T.A.D.P.O.L.E. (Treeborn Frog is in core.)
teledad.ts: Emergency Teleport, Krebons, Psychic Commander, Destiny Hero - Malicious,
Destiny Hero - Disk Commander, Destiny Hero - Diamond Dude, Destiny Hero - Dogma, Dark Grepher,
Armageddon Knight, Destiny Draw (F). (Caius is in monarchs.ts.)
heroes.ts: Elemental Hero Stratos, Elemental Hero Neos Alius, Elemental Hero Wildheart,
Elemental Hero Bubbleman, Elemental Hero Ocean, Elemental Hero Woodsman, Elemental Hero Captain Gold,
Elemental Hero Sparkman, Elemental Hero Clayman, Elemental Hero Avian, Elemental Hero Burstinatrix,
E - Emergency Call, Miracle Fusion, Hero Signal, Hero Barrier, A Hero Emerges, Skyscraper,
Elemental Hero Absolute Zero, Elemental Hero Great Tornado, Elemental Hero Gaia,
Elemental Hero The Shining, Elemental Hero Flame Wingman, Elemental Hero Steam Healer

(F) = Forbidden in Edison — define them anyway so the deck builder can show them.

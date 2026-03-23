// apps/api/services/classifier/classifier.js
// Keyword rule-based complaint classifier (RX-007)
// Phase 1 fallback — same interface as Phase 2 SVM model.
// Routing engine calls classify(text, category) and gets back
// {category, subcategory, priority} — no changes needed when SVM replaces this.

// ── Keyword dictionaries per category ────────────────────────────────────────

const RULES = [
  {
    category: 'CAT-01',
    keywords: ['pothole','road','footpath','pavement','crack','encroach','speed breaker',
               'road damage','tarmac','broken road','footpath damaged'],
    subcats: {
      pothole:        ['pothole','crater','hole in road'],
      crack:          ['crack','fissure','road crack'],
      encroachment:   ['encroach','blocked road','obstruction'],
      speed_breaker:  ['speed breaker','speed bump','hump'],
      broken_footpath:['footpath','pavement','sidewalk'],
    },
    priority: 3,
  },
  {
    category: 'CAT-02',
    keywords: ['drain','drainage','sewer','sewage','manhole','overflow','flood',
               'waterlogging','blocked drain','open drain','gutter'],
    subcats: {
      blocked_drain:  ['blocked drain','choked drain','clogged drain'],
      overflow:       ['overflow','flooding','water overflow'],
      open_manhole:   ['manhole','open manhole','uncovered manhole'],
      sewage_on_road: ['sewage','sewer','stench','foul smell'],
    },
    priority: 2,
  },
  {
    category: 'CAT-03',
    keywords: ['streetlight','street light','light','lamp','pole','electric pole',
               'no light','dark street','light not working','flickering'],
    subcats: {
      light_out:      ['light not working','no light','dark','light out'],
      flickering:     ['flickering','blinking','intermittent light'],
      broken_pole:    ['broken pole','fallen pole','pole damaged'],
      cable_exposed:  ['cable','wire exposed','live wire'],
    },
    priority: 3,
  },
  {
    category: 'CAT-04',
    keywords: ['garbage','waste','trash','rubbish','litter','dump','bin','dead animal',
               'sanitation','stink','smell','overflowing bin'],
    subcats: {
      garbage_dump:       ['garbage dump','waste dump','illegal dump'],
      uncollected_waste:  ['uncollected','not collected','garbage not picked'],
      bin_overflow:       ['bin overflow','dustbin full','overflowing'],
      dead_animal:        ['dead animal','dead dog','dead cow','carcass'],
    },
    priority: 3,
  },
  {
    category: 'CAT-05',
    keywords: ['water','supply','tap','pipeline','pipe','leakage','burst','no water',
               'water pressure','contamination','dirty water'],
    subcats: {
      no_water:         ['no water','water not coming','water supply stopped'],
      low_pressure:     ['low pressure','weak flow','pressure drop'],
      contamination:    ['contamination','dirty water','muddy water','smell in water'],
      leakage:          ['leakage','leak','water leaking','pipe leak'],
      pipe_burst:       ['burst','pipe burst','main burst'],
    },
    priority: 2,
  },
  {
    category: 'CAT-06',
    keywords: ['park','garden','bench','playground','public space','tree','vegetation',
               'broken bench','damaged equipment','overgrown'],
    subcats: {
      broken_bench:       ['broken bench','damaged bench'],
      overgrown_vegetation:['overgrown','bushes','vegetation','grass'],
      damaged_equipment:  ['playground','equipment damaged','slide','swing'],
      encroachment:       ['park encroach','illegal structure in park'],
    },
    priority: 4,
  },
  {
    category: 'CAT-07',
    keywords: ['encroachment','illegal','vendor','hawker','parking','obstruction',
               'illegal structure','blocked','squatter'],
    subcats: {
      illegal_structure:  ['illegal structure','unauthorized construction'],
      vendor_blocking:    ['vendor','hawker','street vendor blocking'],
      parking_violation:  ['parking','illegal parking','blocking driveway'],
    },
    priority: 4,
  },
  {
    category: 'CAT-08',
    keywords: ['noise','pollution','dust','smoke','air quality','construction noise',
               'loud','music','loudspeaker','industrial'],
    subcats: {
      noise:              ['noise','loud','music','loudspeaker','horn'],
      air_quality:        ['air quality','pollution','smog','haze'],
      construction_dust:  ['dust','construction dust','cement dust'],
      industrial_smoke:   ['smoke','factory','industrial','fumes'],
    },
    priority: 4,
  },
  {
    category: 'CAT-09',
    keywords: ['stray','dog','cow','animal','cattle','injured animal','stray dog',
               'stray cow','monkey','pig'],
    subcats: {
      stray_dogs:   ['stray dog','dog bite','pack of dogs'],
      cattle_on_road:['cow','cattle','bull','buffalo on road'],
      injured_animal:['injured','wounded animal','sick animal'],
    },
    priority: 3,
  },
];

// Priority modifier — critical infrastructure gets bumped up
const PRIORITY_BUMP_KEYWORDS = [
  'burst','flood','collapse','emergency','dangerous','accident',
  'injury','hospital','urgent','critical','electrocution',
];

// ── classify() ────────────────────────────────────────────────────────────────
// text:     complaint description (may be empty)
// category: category pre-selected by citizen (CAT-01..CAT-10)
//           If provided and non-CAT-10, use it directly — citizen intent wins.
//           Run text matching to confirm subcategory and adjust priority.

function classify(text = '', category = null) {
  const normalised = text.toLowerCase().trim();

  // If citizen selected a specific category (not catch-all), use it
  let matched = null;
  if (category && category !== 'CAT-10') {
    matched = RULES.find(r => r.category === category);
  }

  // If no category or catch-all, derive from text
  if (!matched) {
    let bestScore = 0;
    for (const rule of RULES) {
      const score = rule.keywords.filter(kw => normalised.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        matched   = rule;
      }
    }
  }

  // Still nothing — fallback to CAT-10 General
  if (!matched) {
    return { category: 'CAT-10', subcategory: 'general', priority: 3 };
  }

  // Derive subcategory from text
  let subcategory = Object.keys(matched.subcats)[0]; // default = first subcat
  let bestSubScore = 0;
  for (const [sub, kwList] of Object.entries(matched.subcats)) {
    const score = kwList.filter(kw => normalised.includes(kw)).length;
    if (score > bestSubScore) {
      bestSubScore = score;
      subcategory  = sub;
    }
  }

  // Priority bump for emergency keywords
  const hasBump = PRIORITY_BUMP_KEYWORDS.some(kw => normalised.includes(kw));
  const priority = hasBump ? Math.max(1, matched.priority - 1) : matched.priority;

  return { category: matched.category, subcategory, priority };
}

module.exports = { classify };
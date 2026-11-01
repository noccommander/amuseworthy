// Scoring, import and export logic for Amuseworthy.
// No DOM access here, so the same file runs in the browser (window.IdeaCore)
// and under `node --test`.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IdeaCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Gates first, then the 12-line scorecard from the evaluation framework, then
  // the criteria from the original "Ideation Calculator" sheet in its column order.
  const CRITERIA = [
    { id: 'gate-goal', name: 'Gate 1 (pass/fail): State the goal' },
    { id: 'gate-done-work', name: 'Gate 2 (pass/fail): You have done the work' },
    { id: 'gate-one-product', name: 'Gate 3 (pass/fail): One product, one avatar, one channel' },
    { id: 'gate-industry', name: 'Gate 4 (pass/fail): The industry is not shrinking under you' },
    { id: 'stickiness', name: 'Stickiness' },
    { id: 'gross-margin', name: 'Gross margin' },
    { id: 'market-tailwind', name: 'Market tailwind' },
    { id: 'operational-drag', name: 'Operational drag' },
    { id: 'moat', name: 'Moat' },
    { id: 'value-equation', name: 'Value equation' },
    { id: 'guarantee', name: 'Offer you can guarantee' },
    { id: 'cash-30-day', name: '30-day cash' },
    { id: 'ltgp-cac', name: 'Lifetime gross profit to acquisition cost' },
    { id: 'first-customers', name: 'First customers without ads' },
    { id: 'proof-loop', name: 'Proof loop' },
    { id: 'can-leave', name: 'You can leave it' },
    { id: 'need-solution-value', name: 'The Need, Solution, and Value Skew' },
    { id: 'market-entry', name: 'Entry Into The Marketplace' },
    { id: 'control-dependency', name: 'Control and Third-Party Dependency' },
    { id: 'replication', name: 'Replication of Product/Solution' },
    { id: 'market-size', name: 'Market Size (Scale and/or Magnitude)' },
    { id: 'market-access', name: 'Access to Markets' },
    { id: 'small-cost', name: 'Small Cost to Try' },
    { id: 'sells-already', name: 'Sells Already' },
    { id: 'collectable', name: 'Collectable' },
  ];
  // Lines that were removed, each merged into the line that asks the same
  // question. An idea saved before keeps its note on the removed line, added to
  // the merged line's note (or the idea's notes, when that note would be too
  // long), and a manual fail on it still fails the idea.
  const MERGED = {
    automation: { into: 'can-leave', name: 'Automation (You and The Product)' },
    'type-of-use': { into: 'stickiness', name: 'Type of Use' },
    'single-feature': { into: 'gate-one-product', name: 'Single Feature' },
    'trending-market': { into: 'gate-industry', name: 'Trending Market' },
  };
  const CRITERION_IDS = new Set(CRITERIA.map((c) => c.id));
  const GATE_IDS = CRITERIA.filter((c) => c.id.startsWith('gate-')).map((c) => c.id);
  // Gates are answered Pass or Fail; every other line is rated in stars.
  const isGate = (id) => GATE_IDS.includes(id);
  const GATE_VALUES = ['pass', 'fail'];

  const STATUSES = ['Not Started', 'In Progress', 'Done'];

  // The framework's 12-line scorecard: its weight for each goal, and the verdict
  // bands for the weighted total. Lines are scored 0-4, which is stars minus one.
  const GOALS = {
    income: {
      label: 'Income',
      weights: {
        stickiness: 3, 'gross-margin': 4, 'market-tailwind': 2, 'operational-drag': 3, moat: 1, 'value-equation': 5,
        guarantee: 5, 'cash-30-day': 5, 'ltgp-cac': 4, 'first-customers': 4, 'proof-loop': 4, 'can-leave': 1,
      },
      bands: [145, 120, 90],
    },
    asset: {
      label: 'Asset',
      weights: {
        stickiness: 5, 'gross-margin': 4, 'market-tailwind': 2, 'operational-drag': 4, moat: 3, 'value-equation': 4,
        guarantee: 4, 'cash-30-day': 4, 'ltgp-cac': 5, 'first-customers': 3, 'proof-loop': 4, 'can-leave': 5,
      },
      bands: [165, 140, 100],
    },
  };
  const SCORECARD_IDS = Object.keys(GOALS.income.weights);
  const VERDICTS = ['This is the idea', 'Buildable', 'Fix one or two lines', 'Kill or redesign'];
  const MAX_STARS = 5;
  const MAX_WEIGHT = 5;
  // The most ideas one person keeps. (The database allows twice as many, so
  // Replace all can save the new ideas before deleting the old ones.)
  const MAX_IDEAS = 100;
  // The most characters each text field holds; the app doesn't save longer text.
  // Counted in Unicode code points, as score.py counts them: most emoji are
  // one, but one with a skin tone or a flag counts as two, and a family as
  // several. An idea with every field full stays far below the database's
  // 128 KB per idea.
  const TEXT_LIMITS = { name: 120, tags: 200, notes: 2000, ratingNote: 1000, status: 40 };
  const textLength = (text) => [...String(text)].length;
  // Backups and saved data are at this version; older ones are brought up to date on reading.
  const DATA_VERSION = 5;

  // A random UUID (the database stores ideas under it). crypto.randomUUID is
  // missing on pages opened from a file, so build one there from
  // crypto.getRandomValues, which is just as random and works everywhere.
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const toRating = (n) => (Number.isInteger(n) && n >= 1 && n <= MAX_STARS ? n : null);

  // Accepts 3, "3", "3/5", "3 stars", "★★★" or "⭐⭐⭐". Anything else, such as 4.5
  // or "3★", is unrated.
  function parseRating(value) {
    if (typeof value === 'number') return toRating(value);
    if (typeof value !== 'string') return null;
    const text = value.trim();
    // Every accepted form is short; a long string can't be one, and checking
    // it against the pattern below would take a long time.
    if (text.length > 20) return null;
    const stars = text.match(/[★⭐]/gu);
    if (stars && /^[★⭐\uFE0F]+$/u.test(text)) return toRating(stars.length);
    const m = text.match(/^(\d)\s*(?:\/\s*5)?\s*(?:stars?)?$/i);
    return m ? toRating(Number(m[1])) : null;
  }

  // Only 'income' and 'asset'; names like 'toString' that every object has don't count.
  const isGoal = (goal) => typeof goal === 'string' && Object.prototype.hasOwnProperty.call(GOALS, goal);

  // Text as the database accepts it: no control characters other than tabs and
  // line breaks, and no half of an emoji (a lone surrogate) left over from cut
  // text. Anything that isn't text or a number becomes empty.
  function cleanText(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  }

  // A date as an ISO string the database can store, or the fallback.
  function isoDate(value, fallback) {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    const date = new Date(value);
    const year = date.getUTCFullYear();
    return year >= 1 && year <= 9999 ? date.toISOString() : fallback;
  }

  // Tags from the comma-separated field or a stored list; anything that isn't text is ignored.
  function normalizeTags(input) {
    const list = (Array.isArray(input) ? input : [input]).flatMap((t) => (typeof t === 'string' ? t.split(/[,;]/) : []));
    const seen = new Set();
    const tags = [];
    for (const raw of list) {
      const tag = cleanText(raw).trim();
      const key = tag.toLowerCase();
      if (tag && !seen.has(key)) {
        seen.add(key);
        tags.push(tag);
      }
    }
    return tags;
  }

  function createIdea(fields = {}) {
    const now = new Date().toISOString();
    return sanitizeIdea({ id: newId(), createdAt: now, updatedAt: now, ...fields });
  }

  const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

  // Coerces stored or imported data into a well-formed idea, or null. Never
  // throws, whatever the data holds.
  function sanitizeIdea(raw) {
    if (!isRecord(raw)) return null;
    const ratings = {};
    for (const [id, value] of Object.entries(isRecord(raw.ratings) ? raw.ratings : {})) {
      const r = parseRating(value);
      if (CRITERION_IDS.has(id) && !isGate(id) && r !== null) ratings[id] = r;
    }
    const gates = {};
    for (const [id, value] of Object.entries(isRecord(raw.gates) ? raw.gates : {})) {
      if (isGate(id) && GATE_VALUES.includes(value)) gates[id] = value;
    }
    const ratingNotes = {};
    for (const [id, text] of Object.entries(isRecord(raw.ratingNotes) ? raw.ratingNotes : {})) {
      if (CRITERION_IDS.has(id) && typeof text === 'string' && text.trim()) ratingNotes[id] = cleanText(text);
    }
    // Without settings of its own, an idea starts from its goal's weights.
    const settings = isRecord(raw.settings) ? sanitizeSettings(raw.settings) : defaultSettings(raw.goal);
    let notes = cleanText(raw.notes);
    const oldNotes = isRecord(raw.ratingNotes) ? raw.ratingNotes : {};
    const oldSettings = isRecord(raw.settings) && isRecord(raw.settings.criteria) ? raw.settings.criteria : {};
    // Joins a paragraph onto the end of a note.
    const join = (note, text) => (note.trim() ? `${note.trimEnd()}\n\n${text}` : text);
    for (const [from, { into, name }] of Object.entries(MERGED)) {
      const text = typeof oldNotes[from] === 'string' ? cleanText(oldNotes[from]).trim() : '';
      const moved = `${name}: ${text}`;
      if (text) {
        // Onto the merged line's note, unless that makes it too long to edit;
        // then onto the idea's notes, if they have room. Nothing is ever cut.
        const onLine = join(ratingNotes[into] || '', moved);
        const onIdea = join(notes, moved);
        if (textLength(onLine) <= TEXT_LIMITS.ratingNote || textLength(onIdea) > TEXT_LIMITS.notes) ratingNotes[into] = onLine;
        else notes = onIdea;
      }
      if (isRecord(oldSettings[from]) && oldSettings[from].failVerdict === true) {
        if (isGate(into)) gates[into] = 'fail';
        else settings.criteria[into].failVerdict = true;
      }
    }
    const now = new Date().toISOString();
    const idea = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
      name: cleanText(raw.name).trim() || 'Name your idea here',
      notes,
      // The app's own statuses are short; one read from elsewhere is cut to the limit.
      status: [...cleanText(raw.status).trim()].slice(0, TEXT_LIMITS.status).join('').trim() || STATUSES[0],
      tags: normalizeTags(raw.tags),
      ratings,
      gates,
      ratingNotes,
      goal: isGoal(raw.goal) ? raw.goal : '',
      settings,
      createdAt: isoDate(raw.createdAt, now),
      updatedAt: isoDate(raw.updatedAt, now),
    };
    if (raw.example === true) idea.example = true;
    return idea;
  }

  // Puts together two versions of one idea, `mine` and `theirs`, both changed
  // from `base` (the copy they started from; null when there was none): each
  // field, and each line's stars, gate, note and settings, comes from the side
  // that changed it, and from `mine` where both did. So edits made to different
  // parts of an idea on two devices are both kept. The result is a well-formed
  // idea, last changed when the later of the two was.
  // `base` may also be a list of copies, when it isn't known which of them the
  // other side started from (a save whose answer was lost): a value counts as
  // changed on a side only if it differs from all of them.
  function mergeIdeas(base, mine, theirs) {
    const bases = (Array.isArray(base) ? base : [base]).map((b) => b ?? {});
    if (!bases.length) bases.push({});
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const changed = (value, at) => bases.every((b) => !same(value, at(b)));
    // Mine, unless only theirs changed it.
    const choose = (ours, others, at) => (changed(ours, at) || !changed(others, at) ? ours : others);
    const pick = (key) => choose(mine[key], theirs[key], (b) => b[key]);
    // Per key of a map (ratings, gates, notes, criteria): a key removed on one side stays removed.
    const pickEach = (map, ours = {}, others = {}) => {
      const out = {};
      for (const key of new Set([...Object.keys(ours), ...Object.keys(others)])) {
        const value = choose(ours[key], others[key], (b) => map(b)?.[key]);
        if (value !== undefined) out[key] = value;
      }
      return out;
    };
    const later = (a, b) => (Date.parse(a) >= Date.parse(b) ? a : b);
    return sanitizeIdea({
      id: mine.id,
      name: pick('name'),
      notes: pick('notes'),
      status: pick('status'),
      tags: pick('tags'),
      goal: pick('goal'),
      ratings: pickEach((b) => b.ratings, mine.ratings, theirs.ratings),
      gates: pickEach((b) => b.gates, mine.gates, theirs.gates),
      ratingNotes: pickEach((b) => b.ratingNotes, mine.ratingNotes, theirs.ratingNotes),
      // Per line, each of its settings (weight, counted, fail verdict) on its own.
      settings: {
        criteria: Object.fromEntries(
          [...new Set([...Object.keys(mine.settings?.criteria ?? {}), ...Object.keys(theirs.settings?.criteria ?? {})])].map((id) => [
            id,
            pickEach((b) => b.settings?.criteria?.[id], mine.settings?.criteria?.[id], theirs.settings?.criteria?.[id]),
          ])
        ),
      },
      createdAt: theirs.createdAt,
      updatedAt: later(mine.updatedAt, theirs.updatedAt),
      example: mine.example === true && theirs.example === true,
    });
  }

  // ---------- Criterion settings ----------
  // Each idea has its own: weight (1-5), whether the criterion counts toward
  // the average, and whether it fails the verdict by hand ("Fail verdict").
  // Older data's deal-breaker marks are not carried over.

  function sanitizeSettings(raw) {
    const criteria = {};
    for (const c of CRITERIA) {
      const s = isRecord(raw) && isRecord(raw.criteria) && isRecord(raw.criteria[c.id]) ? raw.criteria[c.id] : {};
      // Whole numbers from 1 to 5 only; gates have no weight.
      const weight = typeof s.weight === 'number' || typeof s.weight === 'string' ? Number(s.weight) : NaN;
      criteria[c.id] = {
        weight: Number.isInteger(weight) && weight >= 1 && weight <= MAX_WEIGHT && !isGate(c.id) ? weight : 1,
        enabled: s.enabled !== false,
        failVerdict: s.failVerdict === true && !isGate(c.id),
      };
    }
    return { criteria };
  }

  const DEFAULT_SETTINGS = sanitizeSettings(null);

  function criterionSettings(settings, id) {
    return (settings || DEFAULT_SETTINGS).criteria[id] || DEFAULT_SETTINGS.criteria[id];
  }

  // Default settings for an idea: the goal's weights on the 12 scorecard lines
  // (when a goal is set), x1 everywhere else, every criterion counted.
  function defaultSettings(goal) {
    const settings = sanitizeSettings(null);
    if (isGoal(goal)) for (const id of SCORECARD_IDS) settings.criteria[id].weight = GOALS[goal].weights[id];
    return settings;
  }

  // Sets the idea's goal and moves the 12 scorecard lines' weights to that
  // goal's values. Ratings and every other setting stay as they are.
  function setGoal(idea, goal) {
    idea.goal = isGoal(goal) ? goal : '';
    if (idea.goal) {
      for (const id of SCORECARD_IDS) idea.settings.criteria[id].weight = GOALS[idea.goal].weights[id];
    }
    return idea;
  }

  // Puts the idea back to its starting point: every star line at 1 star, gates
  // unanswered, and the default settings for its goal. Name, notes, status,
  // tags and goal stay.
  function resetToDefault(idea) {
    idea.ratings = Object.fromEntries(CRITERIA.filter((c) => !isGate(c.id)).map((c) => [c.id, 1]));
    idea.gates = {};
    idea.settings = defaultSettings(idea.goal);
    return idea;
  }

  // Average Stars is the weighted mean of the rated criteria that count:
  // sum(stars x weight) / sum(weight). Unrated and switched-off criteria, and the
  // pass/fail gates, are left out.
  function scoreIdea(idea, settings = idea.settings) {
    let sum = 0;
    let weights = 0;
    let rated = 0;
    let total = 0;
    for (const c of CRITERIA) {
      if (isGate(c.id)) continue;
      const s = criterionSettings(settings, c.id);
      if (!s.enabled) continue;
      total++;
      const r = idea.ratings[c.id];
      if (r == null) continue;
      rated++;
      sum += r * s.weight;
      weights += s.weight;
    }
    return { average: weights ? sum / weights : null, rated, total };
  }

  // The framework's verdict, from the 12 scorecard lines and the goal's weights.
  // It needs a goal, all four gates on Pass and all 12 lines rated; the idea's own weight sliders and
  // Counts switches don't change it. A gate answered Fail, or any line switched
  // to "Fail verdict manually", fails the idea: status 'failed', with no label,
  // and the reasons in failedGates and failedManually.
  function verdict(idea) {
    const goal = isGoal(idea.goal) ? GOALS[idea.goal] : null;
    const failedGates = GATE_IDS.filter((id) => idea.gates[id] === 'fail');
    const failedManually = CRITERIA.filter((c) => criterionSettings(idea.settings, c.id).failVerdict).map((c) => c.id);
    const rated = SCORECARD_IDS.filter((id) => idea.ratings[id] != null).length;
    const gatesPassed = GATE_IDS.every((id) => idea.gates[id] === 'pass');
    const fails = { failedGates, failedManually, gatesPassed };
    if (!goal) return { status: 'no-goal', ...fails, rated, total: SCORECARD_IDS.length };
    if (failedGates.length || failedManually.length) {
      return { status: 'failed', ...fails, goal: idea.goal, rated, total: SCORECARD_IDS.length };
    }
    if (!gatesPassed || rated < SCORECARD_IDS.length) {
      return { status: 'incomplete', ...fails, goal: idea.goal, rated, total: SCORECARD_IDS.length };
    }
    let score = 0;
    let max = 0;
    for (const id of SCORECARD_IDS) {
      score += (idea.ratings[id] - 1) * goal.weights[id];
      max += 4 * goal.weights[id];
    }
    let level = goal.bands.findIndex((min) => score >= min);
    if (level === -1) level = VERDICTS.length - 1;
    return { status: 'scored', ...fails, goal: idea.goal, score, max, level, label: VERDICTS[level] };
  }

  const SORTERS = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
  };
  const SORT_KEYS = ['score', ...Object.keys(SORTERS)];

  // Sorts by 'name', 'updated', or Average Stars for anything else.
  function sortIdeas(ideas, key = 'score') {
    if (Object.prototype.hasOwnProperty.call(SORTERS, key)) return [...ideas].sort(SORTERS[key]);
    const scores = new Map(ideas.map((i) => [i.id, scoreIdea(i).average]));
    return [...ideas].sort((a, b) => {
      const sa = scores.get(a.id);
      const sb = scores.get(b.id);
      if (sa === null && sb === null) return a.name.localeCompare(b.name);
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa || a.name.localeCompare(b.name);
    });
  }

  // ---------- JSON backup ----------

  function toBackup(ideas) {
    return JSON.stringify({ app: 'ideation-calculator', version: DATA_VERSION, exportedAt: new Date().toISOString(), ideas }, null, 2);
  }

  // Before version 4 a goal didn't set weights. Apply them where the 12 scorecard
  // weights are all still at the x1 default, so nothing set by hand is overwritten.
  function upgradeIdeas(ideas, version) {
    if (!(version >= 4)) {
      for (const idea of ideas) {
        if (idea.goal && SCORECARD_IDS.every((id) => idea.settings.criteria[id].weight === 1)) setGoal(idea, idea.goal);
      }
    }
    return ideas;
  }

  // An idea's data as the database writes it out (jsonb::text), which is
  // what its size limit measures: keys in order of their length in bytes and
  // then byte by byte, a space after each ":" and ",", and strings escaped as
  // JSON.stringify escapes them. Whole numbers only (an idea has no others;
  // the database would keep a decimal's digits).
  const utf8 = (text) => new TextEncoder().encode(text);
  function jsonbText(value) {
    if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).filter((k) => value[k] !== undefined);
      const order = (a, b) => {
        const x = utf8(a);
        const y = utf8(b);
        if (x.length !== y.length) return x.length - y.length;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
        return 0;
      };
      return `{${keys.sort(order).map((k) => `${JSON.stringify(k)}: ${jsonbText(value[k])}`).join(', ')}}`;
    }
    return JSON.stringify(value);
  }

  // The most an idea's data may be in the database (ideas_data_size, 128 KB),
  // measured as the database measures it. An idea within the app's text
  // limits is about 112 KB at most; text past them, which older versions'
  // merged notes may keep (nothing is cut), is fine as long as the idea fits.
  const MAX_IDEA_BYTES = 131072;
  const dataSize = (idea) => utf8(jsonbText(idea)).length;
  const tooBigToSave = (idea) => dataSize(idea) > MAX_IDEA_BYTES;

  // A backup of the most ideas an account holds, every field full of 4-byte
  // characters (emoji), is about 11.4 MB: TEXT_LIMITS count characters, not
  // bytes. 160 KB an idea leaves room for the database's 128 KB and the
  // backup's indents; a file bigger than that isn't a backup, and would only
  // freeze the page.
  const MAX_IMPORT_BYTES = MAX_IDEAS * 160 * 1024;
  const TOO_BIG_TO_IMPORT = `This is bigger than any backup from this app (over ${Math.round(MAX_IMPORT_BYTES / 1000000)} MB), so it was not read.`;

  // Reads a pasted or uploaded JSON backup. Ideas too big for the database
  // are left out and named in `tooBig`: it would refuse them every time, and
  // the account could never finish saving.
  // `forAccount` false (the app without accounts, ideas kept in this browser):
  // no database, so no idea is too big for one.
  function parseImport(text, { forAccount = true } = {}) {
    const trimmed = String(text).trim();
    if (!trimmed) throw new Error('There is nothing to import.');
    if (trimmed.length > MAX_IMPORT_BYTES) throw new Error(TOO_BIG_TO_IMPORT);
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('This is not a JSON backup, or only part of it was copied. Export a backup from this app and try again.');
    }
    const list = Array.isArray(data) ? data : data && data.ideas;
    if (!Array.isArray(list)) throw new Error('This JSON has no list of ideas.');
    // Version 2 backups kept one set of settings for all ideas; give each idea a copy.
    const shared = Array.isArray(data) ? null : data.settings;
    // Imported ideas get fresh ids so adding a backup twice never collides,
    // and are never examples (which Remove examples deletes without asking).
    // Entries that aren't ideas with a name (numbers, text, empty values, other
    // kinds of objects) are skipped.
    const read = list
      .filter((i) => isRecord(i) && typeof i.name === 'string' && i.name.trim())
      .map((i) => sanitizeIdea({ ...i, id: undefined, example: undefined, settings: i.settings || shared }))
      .filter(Boolean);
    const ideas = upgradeIdeas(read, Array.isArray(data) ? 0 : Number(data.version));
    if (!forAccount) return { ideas, tooBig: [] };
    return { ideas: ideas.filter((i) => !tooBigToSave(i)), tooBig: ideas.filter(tooBigToSave).map((i) => i.name) };
  }

  return {
    CRITERIA,
    STATUSES,
    MAX_STARS,
    MAX_WEIGHT,
    MAX_IDEAS,
    TEXT_LIMITS,
    textLength,
    MAX_IDEA_BYTES,
    jsonbText,
    dataSize,
    tooBigToSave,
    MAX_IMPORT_BYTES,
    TOO_BIG_TO_IMPORT,
    DATA_VERSION,
    SORT_KEYS,
    upgradeIdeas,
    GOALS,
    isGoal,
    GATE_IDS,
    GATE_VALUES,
    isGate,
    MERGED,
    SCORECARD_IDS,
    VERDICTS,
    cleanText,
    verdict,
    defaultSettings,
    setGoal,
    resetToDefault,
    sanitizeSettings,
    criterionSettings,
    parseRating,
    normalizeTags,
    createIdea,
    sanitizeIdea,
    mergeIdeas,
    scoreIdea,
    sortIdeas,
    toBackup,
    parseImport,
  };
});

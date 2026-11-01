(function () {
  'use strict';

  const core = window.IdeaCore;
  const { CRITERIA, STATUSES, MAX_STARS } = core;
  const DESCRIPTIONS = window.IdeaDescriptions || { CRITERIA: {}, NOTES: {} };
  const landingLib = window.IdeaLanding;

  const STORAGE_KEY = 'ideation-calculator/v1';
  const STAR_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96z"/></svg>';

  const $ = (sel) => document.querySelector(sel);
  const els = {
    list: $('#idea-list'),
    listCount: $('#list-count'),
    editor: $('#editor'),
    workbench: $('#view-ideas'),
    matrixView: $('#view-matrix'),
    matrix: $('#matrix'),
    tabIdeas: $('#tab-ideas'),
    tabMatrix: $('#tab-matrix'),
    tabCoach: $('#tab-coach'),
    tabSettings: $('#open-settings'),
    settingsView: $('#view-settings'),
    search: $('#search'),
    filterStatus: $('#filter-status'),
    filterTag: $('#filter-tag'),
    sort: $('#sort'),
    banner: $('#example-banner'),
  };

  const state = {
    ideas: [],
    selectedId: null,
    view: 'ideas',
    sort: 'score',
    query: '',
    status: '',
    tag: '',
    showGuides: false,
    showNotes: false,
    // The tab shown on an idea: 'scorecard', 'competition' or 'landing'.
    ideaTab: 'scorecard',
    // Whether the 9 lines from the original sheet are unfolded.
    showOther: false,
    // What Compare puts side by side: ideas with one goal ({ kind: 'goal',
    // value: 'income' | 'asset' }) or one tag ({ kind: 'tag', value }); null
    // until chosen.
    compare: null,
  };

  // With src/config.js filled in, ideas live in the signed-in person's account
  // (see src/cloud.js); otherwise they stay in this browser.
  const cloud = window.IdeaCloud || { enabled: false };
  const PREFS_KEY = 'ideation-calculator/prefs';
  let signedIn = false;
  // Who is signed in, while their ideas load and after.
  let account = null;

  // ---------- Persistence ----------

  // Only the sorts the Sort menu offers.
  const setSort = (sort) => {
    if (core.SORT_KEYS.includes(sort)) state.sort = sort;
  };

  // Ideas saved in this browser (browser-only mode, for development and the
  // tests), with the sort and the Show All switches saved alongside. Returns
  // null when nothing is saved. Saved data that can't be read is kept under
  // another key, not overwritten.
  function load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || !Array.isArray(data.ideas ?? [])) throw new Error('No list of ideas');
      setSort(data.sort);
      if (typeof data.showGuides === 'boolean') state.showGuides = data.showGuides;
      if (typeof data.showNotes === 'boolean') state.showNotes = data.showNotes;
      if (typeof data.showOther === 'boolean') state.showOther = data.showOther;
      // Before version 3 one set of criteria settings was shared by all ideas; give each idea a copy.
      const shared = data.settings;
      const ideas = (data.ideas || [])
        .map((i) => core.sanitizeIdea(i && !i.settings && shared ? { ...i, settings: shared } : i))
        .filter(Boolean);
      return core.upgradeIdeas(ideas, data.version);
    } catch (err) {
      try {
        localStorage.setItem(`${STORAGE_KEY}/unreadable-${Date.now()}`, raw);
        console.warn(`Saved ideas could not be read (${err.message}); they were kept under another key.`);
      } catch {
        // No room to keep a copy: they stay where they are, and nothing is
        // saved over them this visit (save).
        keepUnreadable = true;
        console.warn(`Saved ideas could not be read (${err.message}), and there is no room to copy them; they are left as they are.`);
        showStorageProblem("Your saved ideas couldn't be read, and this browser has no room to keep a copy, so they are left as they are and nothing is saved this visit. Export anything you change here.");
      }
      return null;
    }
  }

  // True while saved ideas that couldn't be read have nowhere else to go:
  // saving would overwrite the only copy.
  let keepUnreadable = false;

  // Says, above the list, that changes aren't being kept in this browser; an
  // empty message hides it again.
  function showStorageProblem(message) {
    const el = $('#storage-banner');
    el.hidden = !message;
    el.querySelector('p').textContent = message;
  }

  // Counts changes made in this tab, so a refresh that started before one is
  // dropped (refreshIdeas): what it read is older than what this tab has.
  let edits = 0;

  function save() {
    edits++;
    if (cloud.enabled) {
      savePrefs();
      if (signedIn) scheduleSync();
      return;
    }
    if (keepUnreadable) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: core.DATA_VERSION,
          sort: state.sort,
          showGuides: state.showGuides,
          showNotes: state.showNotes,
          showOther: state.showOther,
          ideas: state.ideas,
        }));
      showStorageProblem('');
    } catch {
      // Storage can be full or unavailable (private windows); the app still
      // works for this visit, but nothing is kept after it.
      showStorageProblem("Your changes can't be saved in this browser: its storage is full or turned off. They last until you close this page, so export them to keep them.");
    }
  }

  // In cloud mode ideas go to the account, but the sort and the Show All Guides
  // and Show All Notes switches are remembered per browser.
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: state.sort, showGuides: state.showGuides, showNotes: state.showNotes, showOther: state.showOther }));
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  }

  function loadPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      setSort(prefs.sort);
      if (typeof prefs.showGuides === 'boolean') state.showGuides = prefs.showGuides;
      if (typeof prefs.showNotes === 'boolean') state.showNotes = prefs.showNotes;
      if (typeof prefs.showOther === 'boolean') state.showOther = prefs.showOther;
    } catch {
      // Defaults are fine.
    }
  }

  function exampleIdeas() {
    // Ratings in the original sheet's column order; Automation, Type of Use, Short
    // Obligation One Month, Solo, Single Feature, Trending Market and Invented
    // Category are no longer criteria and are dropped on load.
    const SHEET = ['need-solution-value', 'market-entry', 'control-dependency', 'automation', 'replication', 'market-size',
      'type-of-use', 'market-access', 'short-obligation', 'solo', 'small-cost', 'sells-already', 'single-feature',
      'collectable', 'trending-market', 'different', 'depth', 'clarity', 'one-sentence-value', 'invented-category',
      'bold', 'proof', 'own-a-word'];
    const rate = (values) => Object.fromEntries(SHEET.map((id, i) => [id, values[i]]).filter(([, v]) => v));
    // Scorecard ratings in the framework's order, Stickiness to You can leave it.
    const score = (values) => Object.fromEntries(core.SCORECARD_IDS.map((id, i) => [id, values[i]]));
    return [
      {
        name: 'Overdue invoice nudges for freelancers',
        notes: 'Connects to Gmail and sends polite follow-ups on unpaid invoices. Flat monthly price.',
        status: 'In Progress',
        tags: ['saas', 'freelancers'],
        goal: 'income',
        gates: { 'gate-goal': 'pass', 'gate-done-work': 'pass', 'gate-one-product': 'pass', 'gate-industry': 'pass' },
        ratings: {
          ...rate([5, 4, 3, 5, 3, 4, 4, 3, 4, 5, 5, 4, 5, 2, 3, 3, 3, 5, 5, 2, 3, 3, 3]),
          ...score([5, 5, 4, 4, 2, 4, 3, 2, 3, 3, 3, 3]),
        },
      },
      {
        name: 'Printable habit tracker packs',
        notes: 'Seasonal PDF planners sold on Etsy, one theme per month.',
        status: 'Not Started',
        tags: ['digital product'],
        ratings: rate([3, 5, 2, 5, 1, 4, 3, 4, 5, 5, 5, 5, 4, 5, 3, 2, 2, 5, 4, 1, 2, 4, 1]),
      },
      {
        name: 'Menu translation for local restaurants',
        notes: 'Translate and typeset menus for tourist season. Still deciding on pricing.',
        status: 'Not Started',
        tags: ['service', 'tourism'],
        ratings: rate([4, 3, 4, 2, 4, 2, 3, 4, 4, 4, 5, 3, 0, 0, 4, 0, 0, 4, 4, 0, 0, 0, 0]),
      },
    ].map((i) => core.setGoal(core.createIdea({ ...i, example: true }), i.goal));
  }

  // ---------- Helpers ----------

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  const fmt = (n, digits = 1) => (n == null ? '–' : n.toFixed(digits));
  const selected = () => state.ideas.find((i) => i.id === state.selectedId) || null;
  const isNarrow = () => window.matchMedia('(max-width: 820px)').matches;
  // Criteria settings belong to each idea; by default, the selected one.
  const setting = (id, idea = selected()) => core.criterionSettings(idea?.settings, id);
  const score = (idea) => core.scoreIdea(idea);
  const isWeighted = (idea) => CRITERIA.some((c) => setting(c.id, idea).weight !== 1);

  // Text fields and their limits. A counter below each shows while typing, or
  // all the time once the text is near the limit. Text over the limit isn't
  // saved: the idea keeps its last text within the limit until it is shortened.
  const LIMIT = core.TEXT_LIMITS;
  function limitFor(el) {
    if (el.id === 'idea-name') return LIMIT.name;
    if (el.id === 'idea-tags') return LIMIT.tags;
    if (el.id === 'idea-notes') return LIMIT.notes;
    return el.dataset.note ? LIMIT.ratingNote : 0;
  }
  function counterState(text, limit) {
    const n = core.textLength(text);
    return { n, over: n > limit, near: n >= limit * 0.9, text: n > limit ? `${n}/${limit} · Too long, not saved` : `${n}/${limit}` };
  }
  const tooLongAttr = (text, limit) => (core.textLength(text) > limit ? ' aria-invalid="true"' : '');
  function counterHTML(fieldId, text, limit) {
    const c = counterState(text, limit);
    return `<span class="char-count${c.over ? ' is-over' : ''}${c.near ? ' is-near' : ''}" id="count-${fieldId}" aria-hidden="true">${c.text}</span>`;
  }
  // Tags count as they are saved: tidied and joined with ", ".
  const tagsText = (value) => core.normalizeTags(value).join(', ');

  // Updates a field's counter. Returns false while its text is over the limit.
  function checkLength(el) {
    const limit = limitFor(el);
    if (!limit) return true;
    const c = counterState(el.id === 'idea-tags' ? tagsText(el.value) : el.value, limit);
    const counter = document.getElementById(`count-${el.id}`);
    if (counter) {
      counter.textContent = c.text;
      counter.classList.toggle('is-over', c.over);
      counter.classList.toggle('is-near', c.near);
    }
    el.setAttribute('aria-invalid', String(c.over));
    // Typed text that isn't saved, for the leave-page warning.
    if (c.over) el.dataset.unsaved = 'true';
    else delete el.dataset.unsaved;
    return !c.over;
  }
  const typedTooLong = () => !!document.querySelector('[data-unsaved]');

  function touch(idea) {
    idea.updatedAt = new Date().toISOString();
    delete idea.example;
    save();
  }

  function statusOptions() {
    const extra = state.ideas.map((i) => i.status).filter((s) => !STATUSES.includes(s));
    return [...STATUSES, ...new Set(extra)];
  }

  function allTags() {
    const seen = new Map();
    for (const idea of state.ideas) for (const t of idea.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  function visibleIdeas() {
    const q = state.query.trim().toLowerCase();
    const filtered = state.ideas.filter((idea) => {
      if (state.status && idea.status !== state.status) return false;
      if (state.tag && !idea.tags.some((t) => t.toLowerCase() === state.tag.toLowerCase())) return false;
      if (q && !`${idea.name} ${idea.notes} ${idea.tags.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    return core.sortIdeas(filtered, state.sort);
  }

  function fillSelect(select, options, current) {
    select.innerHTML =
      '<option value="">All</option>' +
      options.map((o) => `<option value="${escapeHTML(o)}"${o === current ? ' selected' : ''}>${escapeHTML(o)}</option>`).join('');
  }

  // ---------- Rendering ----------

  const goalLabel = (goal) => (core.isGoal(goal) ? core.GOALS[goal].label : '');
  const goalPill = (goal) => (core.isGoal(goal) ? `<span class="pill goal-pill goal-${escapeHTML(goal)}">${escapeHTML(goalLabel(goal))}</span>` : '');

  // Switches built as radio groups take one Tab stop: the chosen option, or the
  // first when none is chosen. Arrow keys move between the options.
  const radioTab = (checked, firstOfNone) => (checked || firstOfNone ? 0 : -1);
  function markRadios(group, isOn) {
    group.querySelectorAll('[role="radio"]').forEach((b, i, all) => {
      const on = isOn(b);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (i === 0 && ![...all].some(isOn)) ? 0 : -1;
    });
  }

  // A two-position switch: picking one goal deselects the other. Each option
  // says what the goal means, from the framework's first gate.
  const GOAL_HINTS = { income: 'You keep working', asset: 'A company you can sell' };

  function goalToggleHTML(goal) {
    return `<div class="goal-toggle" id="goal-toggle" role="radiogroup" aria-labelledby="goal-label" data-goal="${escapeHTML(goal)}">
      <span class="goal-thumb" aria-hidden="true"></span>
      ${Object.entries(core.GOALS)
        .map(
          ([key, g]) =>
            `<button type="button" role="radio" aria-checked="${goal === key}" tabindex="${radioTab(goal === key, key === 'income' && !goal)}" data-set-goal="${key}"><span class="goal-opt-name">${g.label}</span><span class="goal-opt-hint">${GOAL_HINTS[key]}</span></button>`
        )
        .join('')}
    </div>`;
  }

  // The framework verdict as a pill, or a short note on what it still needs.
  // A failed gate or a line failed by hand shows instead of a verdict.
  function verdictHTML(idea, { compact = false } = {}) {
    const v = core.verdict(idea);
    let gates = '';
    if (v.failedGates.length) {
      const names = v.failedGates.map(gateName);
      gates = compact
        ? `<span class="pill verdict verdict-3" title="${escapeHTML(names.join('\n'))}">Gate failed</span> `
        : `<span class="pill verdict verdict-3">Gate failed</span> <span class="verdict-gates">${names.map(escapeHTML).join('<br>')}</span>`;
    }
    let manual = '';
    if (v.failedManually.length) {
      const names = v.failedManually.map((id) => CRITERIA.find((c) => c.id === id).name);
      manual = compact
        ? `<span class="pill verdict verdict-3" title="${escapeHTML(names.join('\n'))}">Failed by hand</span> `
        : `<span class="pill verdict verdict-3">Failed by hand</span> <span class="verdict-gates">${names.map(escapeHTML).join('<br>')}</span>`;
    }
    let card;
    if (v.status === 'scored') {
      card = `<span class="pill verdict verdict-${v.level}">${escapeHTML(v.label)}</span> <span class="verdict-score">${v.score}/${v.max}</span>`;
    } else if (v.status === 'no-goal') {
      card = compact && !gates && !manual ? '<span class="verdict-note">&ndash;</span>' : '';
    } else if (v.status === 'failed') {
      card = '';
    } else if (compact) {
      const open = [!v.gatesPassed && !gates ? 'gates open' : '', v.rated < v.total ? `${v.rated}/${v.total} rated` : ''].filter(Boolean);
      card = open.length ? `<span class="verdict-note">${open.join(' · ')}</span>` : '';
    } else {
      card = '<span class="verdict-note">Pass all Gates and Rate all 12 Gold criteria, to get a verdict.</span>';
    }
    if (compact) return gates + manual + card;
    return [gates, manual, card].filter(Boolean).join('<span class="verdict-break"></span>');
  }

  function renderFilters() {
    const statuses = statusOptions();
    const tags = allTags();
    if (state.status && !statuses.includes(state.status)) state.status = '';
    if (state.tag && !tags.includes(state.tag)) state.tag = '';
    fillSelect(els.filterStatus, statuses, state.status);
    fillSelect(els.filterTag, tags, state.tag);
    els.sort.value = state.sort;
  }

  function rowHTML(idea) {
    const { average, rated, total } = score(idea);
    const pct = average == null ? 0 : (average / MAX_STARS) * 100;
    const tags = idea.tags.map((t) => `<span class="tag">#${escapeHTML(t)}</span>`).join('');
    return `<li><button type="button" class="idea-row" data-id="${escapeHTML(idea.id)}" aria-current="${idea.id === state.selectedId}">
      <span class="idea-row-name">${escapeHTML(idea.name)}</span>
      <span class="idea-row-meta">
        ${rowVerdictHTML(idea)}
        <span class="pill pill-status" data-status="${escapeHTML(idea.status)}">${escapeHTML(idea.status)}</span>
        ${goalPill(idea.goal)}${idea.example ? '<span class="pill pill-example">Example</span>' : ''}${tags}
      </span>
      <span class="idea-row-score">
        <span class="score-num${average == null ? ' is-empty' : ''}">${fmt(average)}</span>
        <span class="score-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
        <span class="score-rated">${rated}/${total}</span>
      </span>
    </button></li>`;
  }

  // Pressing on the list takes focus from a field being edited, and that
  // field's change re-renders the list. Replacing the rows between mouse down
  // and up would lose the click, so while the list is pressed, it waits.
  const listPress = { down: false, stale: false };

  function renderList() {
    if (listPress.down) {
      listPress.stale = true;
      return;
    }
    const items = visibleIdeas();
    const total = state.ideas.length;
    // How many ideas there are out of the most an account holds.
    const count = `${total}/${core.MAX_IDEAS} ideas`;
    els.listCount.textContent = items.length === total ? count : `${items.length} shown · ${count}`;
    els.listCount.classList.toggle('is-full', total >= core.MAX_IDEAS);
    renderUsage();
    if (items.length) {
      els.list.innerHTML = items.map(rowHTML).join('');
    } else if (total) {
      els.list.innerHTML = '<li class="empty"><p>No ideas match these filters.</p><button type="button" class="btn btn-small" data-action="clear-filters">Clear filters</button></li>';
    } else {
      els.list.innerHTML = `<li class="empty"><p>No ideas yet. Add one and rate it on the ${CRITERIA.length} criteria.</p><button type="button" class="btn btn-primary btn-small" data-action="new">New idea</button></li>`;
    }
    els.banner.hidden = !state.ideas.some((i) => i.example);
    els.tabIdeas.querySelector('.nav-label').textContent = `Ideas (${total})`;
  }

  // The verdict as one chip for an idea's row in the list: the band, what
  // failed, or what it still needs.
  function rowVerdictHTML(idea) {
    const v = core.verdict(idea);
    if (v.failedGates.length) return '<span class="pill verdict verdict-3">Gate failed</span>';
    if (v.failedManually.length) return '<span class="pill verdict verdict-3">Failed by hand</span>';
    if (v.status === 'scored') return `<span class="pill verdict verdict-${v.level}">${escapeHTML(v.label)}</span>`;
    if (v.status === 'no-goal') return '<span class="pill verdict verdict-none">Choose a goal</span>';
    return `<span class="pill verdict verdict-none">${v.gatesPassed ? `${v.rated}/${v.total} gold rated` : 'Gates open'}</span>`;
  }

  // The most points the goal's 12 lines can earn: 4 per line, times its weight.
  const maxPoints = (goal) => core.SCORECARD_IDS.reduce((sum, id) => sum + 4 * goal.weights[id], 0);

  // The score strip at the top of an idea: Average Stars, the verdict, the
  // points against the goal's bands, and the four gates.
  function readoutHTML(idea) {
    const { average, rated, total } = score(idea);
    const pct = average == null ? 0 : (average / MAX_STARS) * 100;
    const off = CRITERIA.length - core.GATE_IDS.length - total;
    const v = core.verdict(idea);
    const goal = core.isGoal(idea.goal) ? core.GOALS[idea.goal] : null;
    const showVerdict = idea.goal || v.failedGates.length || v.failedManually.length;
    let next = '';
    if (v.status === 'scored' && v.level > 0) next = `<span class="readout-next">${goal.bands[v.level - 1] - v.score} points to ${escapeHTML(core.VERDICTS[v.level - 1])}</span>`;
    let points = '';
    if (goal) {
      const max = maxPoints(goal);
      const [go, build, fix] = goal.bands;
      const marks = goal.bands.map((b) => `<em style="left:${(b / max) * 100}%"></em>`).join('');
      const bar = v.status === 'scored' ? `<i style="width:${(v.score / max) * 100}%"></i>` : '';
      const label = v.status === 'scored' ? `<span class="readout-score">${v.score} / ${max}</span>` : `<span class="readout-score is-open">${v.rated} of ${v.total} gold lines rated</span>`;
      const bands = [
        [core.VERDICTS[0], `${go}+`],
        [core.VERDICTS[1], `${build}–${go - 1}`],
        [core.VERDICTS[2], `${fix}–${build - 1}`],
        [core.VERDICTS[3], `under ${fix}`],
      ];
      points = `<div class="readout-points">
        <span class="readout-label">Points ${label}</span>
        <div class="progress" role="img" aria-label="${v.status === 'scored' ? `${v.score} of ${max} points` : 'No points yet'}">${bar}${marks}</div>
        <div class="bands"><span style="left:0">0</span><span style="left:${(fix / max) * 100}%">${fix}<small> Fix</small></span><span style="left:${(build / max) * 100}%">${build}<small> Build</small></span><span style="left:${(go / max) * 100}%">${go}<small> Go</small></span></div>
        <details class="readout-how"><summary>How it's scored</summary>
          <p>Only the 12 gold lines decide the verdict: each earns stars minus one, times its weight for ${escapeHTML(goal.label)}. Gates must all pass.</p>
          <table>${bands.map(([name, range], i) => `<tr${v.status === 'scored' && v.level === i ? ' class="is-current"' : ''}><td>${escapeHTML(name)}</td><td>${range}</td></tr>`).join('')}</table>
        </details>
      </div>`;
    }
    const gates = core.GATE_IDS.map((id, i) => {
      const value = idea.gates[id];
      const state = value === 'pass' ? 'is-pass' : value === 'fail' ? 'is-fail' : 'is-empty';
      return `<span class="gate-dot ${state}" title="${escapeHTML(gateName(id))}: ${value || 'not answered'}">${value === 'pass' ? '&#10003;' : value === 'fail' ? '&#10005;' : i + 1}</span>`;
    }).join('');
    const passed = core.GATE_IDS.filter((id) => idea.gates[id] === 'pass').length;
    return `<div class="readout-main">
        <span class="readout-label">Average stars${isWeighted(idea) ? ' &middot; weighted' : ''}</span>
        <span class="readout-value"><strong>${fmt(average, 2)}</strong><span>/ ${MAX_STARS}</span></span>
        <span class="meter" style="--pct:${pct}%" role="img" aria-label="${average == null ? 'Not rated yet' : `${fmt(average, 2)} out of ${MAX_STARS} stars`}"></span>
        <span class="readout-rated">${rated} of ${total} rated${off ? ` &middot; ${off} not counted` : ''}</span>
      </div>
      ${showVerdict ? `<span class="readout-verdict"><span class="readout-label">Verdict${idea.goal ? ` &middot; ${goalLabel(idea.goal)}` : ''}</span>${verdictHTML(idea)}${next}</span>` : ''}
      ${points}
      <div class="readout-gates"><span class="readout-label">Gates</span><span class="gate-dots">${gates}<span class="readout-rated">${passed} of ${core.GATE_IDS.length}</span></span></div>`;
  }

  function starsHTML(criterionId, rating) {
    let html = '';
    for (let n = 1; n <= MAX_STARS; n++) {
      html += `<button type="button" class="star${rating && n <= rating ? ' is-on' : ''}" data-rate="${n}" data-criterion="${criterionId}" aria-pressed="${rating === n}" aria-label="${n} of ${MAX_STARS}">${STAR_SVG}</button>`;
    }
    return html;
  }

  const criterionInfo = (id) => DESCRIPTIONS.CRITERIA[id] || {};
  const noteFor = (info) => (info.note ? DESCRIPTIONS.NOTES[info.note] : null);
  const hasGuide = (info) => !!(info.details?.length || info.scale?.length || info.warning || noteFor(info));

  // A leading label, like "Example A:" in a paragraph or "3 stars:" in a scoring guide, is set in bold.
  function labelledHTML(text, label) {
    const m = text.match(label);
    return m ? `<b>${escapeHTML(m[1])}</b> ${escapeHTML(text.slice(m[0].length))}` : escapeHTML(text);
  }
  const paragraphHTML = (text) => `<p>${labelledHTML(text, /^(Examples?(?: [A-Z])?:)\s*/)}</p>`;
  // A band of the scoring guide, marked with the stars it covers so the one
  // the rating falls in can be shown.
  const scaleLineHTML = (text) => {
    const m = text.match(/^(\d)(?: or (\d))? stars?:/);
    const attrs = m ? ` data-stars="${m[1]}"${m[2] ? ` data-stars-to="${m[2]}"` : ''}` : '';
    return `<li${attrs}><span>${labelledHTML(text, /^(\d(?: or \d)? stars?:)\s*/)}</span></li>`;
  };
  function markBands(row, rating) {
    row.querySelectorAll('.guide li[data-stars]').forEach((li) => {
      const from = Number(li.dataset.stars);
      const to = Number(li.dataset.starsTo || from);
      li.classList.toggle('is-current', !!rating && rating >= from && rating <= to);
    });
  }

  function guideHTML(info) {
    const scale = info.scale?.length
      ? `<div><h4>${escapeHTML(info.scaleLabel || 'How many stars')}</h4><ul>${info.scale.map(scaleLineHTML).join('')}</ul></div>`
      : '';
    const warning = info.warning ? `<p class="guide-warning"><b>Warning:</b> ${escapeHTML(info.warning)}</p>` : '';
    const note = noteFor(info);
    const sections = note
      ? `<div class="guide-sections">${note.sections
          .map((sec) => `<section><h4>${escapeHTML(sec.title)}</h4><ul>${sec.items.map((i) => `<li>${escapeHTML(i)}</li>`).join('')}</ul></section>`)
          .join('')}</div>`
      : '';
    return (info.details || []).map(paragraphHTML).join('') + scale + warning + sections;
  }

  function toggleHTML(target, open, show, hide) {
    return `<button type="button" class="guide-toggle" data-guide="${target}" aria-describedby="crit-${target}" data-show="${show}" data-hide="${hide}" aria-expanded="${open}" aria-controls="guide-${target}">${open ? hide : show}</button>`;
  }

  function badgesHTML(id) {
    const s = setting(id);
    return (
      // Gold lines carry their weight at the row's edge (cbadgeHTML).
      (s.weight > 1 && !core.SCORECARD_IDS.includes(id) ? `<span class="badge badge-weight" title="Counts ${escapeHTML(s.weight)} times in the average">&times;${escapeHTML(s.weight)}</span>` : '') +
      (s.failVerdict ? '<span class="badge badge-fail">Fail verdict manually</span>' : '') +
      (s.enabled ? '' : '<span class="badge badge-off">Not counted</span>')
    );
  }

  function titleHTML(c) {
    return `<span class="criterion-name" id="crit-${c.id}">${escapeHTML(c.name)}</span>${badgesHTML(c.id)}`;
  }

  // The badge at a row's edge: a gate's number, or a gold line's weight.
  function cbadgeHTML(c) {
    if (core.isGate(c.id)) return `<span class="badge badge-gate">G${core.GATE_IDS.indexOf(c.id) + 1}</span>`;
    if (!core.SCORECARD_IDS.includes(c.id)) return '';
    const w = setting(c.id).weight;
    return `<span class="badge badge-weight" title="Counts ${escapeHTML(w)} times in the average">&times;${escapeHTML(w)}</span>`;
  }

  // Pass | Fail switch for a gate, built like the goal switch.
  function gateToggleHTML(id, value) {
    return `<div class="goal-toggle gate-toggle" role="radiogroup" aria-labelledby="crit-${id}" data-value="${escapeHTML(value || '')}" data-gate-toggle="${id}">
      <span class="goal-thumb" aria-hidden="true"></span>
      <button type="button" role="radio" aria-checked="${value === 'pass'}" tabindex="${radioTab(value === 'pass', !value)}" data-gate="${id}" data-value="pass">Pass</button>
      <button type="button" role="radio" aria-checked="${value === 'fail'}" tabindex="${radioTab(value === 'fail', false)}" data-gate="${id}" data-value="fail">Fail</button>
    </div>`;
  }

  // Gate short name for the verdict, e.g. "Gate 2: You have done the work".
  const gateName = (id) => CRITERIA.find((c) => c.id === id).name.replace(' (pass/fail)', '');

  // Weight, Counts and Fail verdict manually controls under each star line. They apply
  // to this idea only. Gates have none: their Pass | Fail switch is the answer.
  function settingsControlsHTML(c, open) {
    if (core.isGate(c.id)) return '';
    const s = setting(c.id);
    const name = escapeHTML(c.name);
    return `<div class="criterion-settings" id="settings-${c.id}"${open ? '' : ' hidden'}>
        <label class="weight"><span class="field-label">Weight</span>
          <input type="range" min="1" max="${core.MAX_WEIGHT}" step="1" value="${escapeHTML(s.weight)}" id="weight-${c.id}" data-weight="${c.id}" aria-label="Weight for ${name}">
          <output class="weight-value" for="weight-${c.id}">&times;${escapeHTML(s.weight)}</output>
        </label>
        <label class="switch"><input type="checkbox" id="counts-${c.id}" data-counts="${c.id}" aria-describedby="crit-${c.id}"${s.enabled ? ' checked' : ''}><span>Counts</span></label>
        <label class="switch switch-fail"><input type="checkbox" id="fail-${c.id}" data-fail="${c.id}" aria-describedby="crit-${c.id}"${s.failVerdict ? ' checked' : ''}><span>Fail verdict manually</span></label>
      </div>`;
  }

  const ACTIONS_IDLE =
    '<button type="button" class="btn btn-small btn-ghost" data-action="duplicate">Duplicate</button>' +
    '<button type="button" class="btn btn-small btn-ghost" data-action="ask-reset">Reset to default</button>' +
    '<button type="button" class="btn btn-small btn-ghost btn-danger" data-action="ask-delete">Delete</button>';
  const GRILL_BUTTON =
    '<button type="button" class="btn btn-small" data-action="grill"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>Pressure-test with AI</button>';

  // The tabs on an idea: its scorecard, and with accounts on, the competition
  // review and the landing page. Which one shows is kept while switching ideas.
  const IDEA_TABS = [
    ['scorecard', 'Scorecard'],
    ['competition', 'Competition'],
    ['landing', 'Landing page'],
  ];
  function ideaTabsHTML(idea) {
    if (!cloud.enabled) return '';
    const counts = { competition: landscape.reviews?.get(idea.id)?.length || 0, landing: landing.drafts.get(idea.id)?.length || 0 };
    return `<div class="idea-tabs" role="tablist" aria-label="Idea">${IDEA_TABS.map(
      ([id, label]) =>
        `<button type="button" role="tab" data-idea-tab="${id}" aria-selected="${state.ideaTab === id}" tabindex="${state.ideaTab === id ? 0 : -1}">${label}${
          id === 'scorecard' ? '' : `<span class="tab-count" data-tab-count="${id}"${counts[id] ? '' : ' hidden'}>${counts[id]}</span>`
        }</button>`
    ).join('')}</div>`;
  }

  // Shows one of the idea's tabs, in place.
  function setIdeaTab(name) {
    if (!IDEA_TABS.some(([id]) => id === name)) return;
    state.ideaTab = name;
    els.editor.querySelectorAll('[data-idea-tab]').forEach((b) => {
      const on = b.dataset.ideaTab === name;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    els.editor.querySelectorAll('[data-tab-panel]').forEach((p) => {
      p.hidden = p.dataset.tabPanel !== name;
    });
  }

  // The counts on the Competition and Landing page tabs, once those have loaded.
  function refreshIdeaTabCounts() {
    const idea = selected();
    if (!idea) return;
    const counts = { competition: landscape.reviews?.get(idea.id)?.length || 0, landing: landing.drafts.get(idea.id)?.length || 0 };
    els.editor.querySelectorAll('[data-tab-count]').forEach((el) => {
      el.textContent = counts[el.dataset.tabCount];
      el.hidden = !counts[el.dataset.tabCount];
    });
  }

  function criterionHTML(c, idea) {
    const rating = idea.ratings[c.id] ?? null;
    const info = criterionInfo(c.id);
    const guide = hasGuide(info);
    const open = guide && state.showGuides;
    const note = idea.ratingNotes[c.id] || '';
    // A note with text is always shown; Show All Notes opens the empty ones too.
    const noteOpen = !!note || state.showNotes;
    const s = setting(c.id);
    const scorecard = core.SCORECARD_IDS.includes(c.id);
    const gate = core.isGate(c.id);
    const answered = gate ? !!idea.gates[c.id] : !!rating;
    const classes = [
      'criterion',
      gate ? 'is-gate' : '',
      gate && idea.gates[c.id] ? `gate-${escapeHTML(idea.gates[c.id])}` : '',
      scorecard ? 'is-scorecard' : '',
      !gate && rating ? `stars-${escapeHTML(rating)}` : '',
      answered ? '' : 'is-unrated',
      !gate && !s.enabled ? 'is-off' : '',
    ]
      .filter(Boolean)
      .join(' ');
    // A line's weight, Counts and Fail switches are folded away unless one of
    // them is off its default, so what changes the score is never hidden.
    const defaultWeight = scorecard && core.isGoal(idea.goal) ? core.GOALS[idea.goal].weights[c.id] : 1;
    const settingsOpen = !gate && (s.weight !== defaultWeight || !s.enabled || !!s.failVerdict);
    const guideBody = guide ? guideHTML(info) : '';
    return `<li class="${classes}" data-criterion-row="${c.id}">
      <span class="criterion-edge" aria-hidden="true"></span>
      <span class="criterion-badge">${cbadgeHTML(c)}</span>
      <span class="criterion-text">
        <span class="criterion-title">${titleHTML(c)}</span>
        ${info.summary ? `<span class="criterion-summary">${escapeHTML(info.summary)}</span>` : ''}
        <span class="criterion-links">
          ${guide ? toggleHTML(c.id, open, 'Expand guide', 'Hide guide') : ''}
          <button type="button" class="guide-toggle" data-note-toggle="${c.id}" aria-describedby="crit-${c.id}" aria-expanded="${noteOpen}" aria-controls="note-${c.id}">${noteOpen ? 'Hide note' : 'Add note'}</button>
          ${gate ? '' : `<button type="button" class="guide-toggle" data-settings-toggle="${c.id}" aria-describedby="crit-${c.id}" aria-expanded="${settingsOpen}" aria-controls="settings-${c.id}">${settingsOpen ? 'Hide settings' : 'Settings'}</button>`}
        </span>
      </span>
      ${gate ? gateToggleHTML(c.id, idea.gates[c.id]) : `<span class="stars" role="group" aria-labelledby="crit-${c.id}">${starsHTML(c.id, rating)}</span>`}
      ${settingsControlsHTML(c, settingsOpen)}
      <div class="rating-note" id="note-${c.id}"${noteOpen ? '' : ' hidden'}>
        <label class="visually-hidden" for="note-input-${c.id}">Note for ${escapeHTML(c.name)}</label>
        <textarea id="note-input-${c.id}" data-note="${c.id}" rows="2" placeholder="Why this rating?" aria-describedby="count-note-input-${c.id}"${tooLongAttr(note, LIMIT.ratingNote)}>${escapeHTML(note)}</textarea>
        ${counterHTML(`note-input-${c.id}`, note, LIMIT.ratingNote)}
      </div>
      ${guide ? `<div class="guide" id="guide-${c.id}"${open ? '' : ' hidden'}>${guideBody}</div>` : ''}
    </li>`;
  }

  // The three parts of the scorecard: the gates, the 12 gold lines, and the 9
  // lines from the original sheet, which fold away.
  const OTHER_IDS = CRITERIA.map((c) => c.id).filter((id) => !core.isGate(id) && !core.SCORECARD_IDS.includes(id));
  const SECTIONS = [
    { id: 'gates', title: 'Gates', ids: core.GATE_IDS },
    { id: 'gold', title: 'Gold lines', ids: core.SCORECARD_IDS },
    { id: 'other', title: 'Other lines', ids: OTHER_IDS },
  ];
  function sectionSummary(id, idea) {
    const v = core.verdict(idea);
    if (id === 'gates') {
      const passed = core.GATE_IDS.filter((g) => idea.gates[g] === 'pass').length;
      return `${passed} of ${core.GATE_IDS.length} pass · any Fail means no verdict`;
    }
    if (id === 'gold') {
      const goal = core.isGoal(idea.goal) ? core.GOALS[idea.goal] : null;
      const points = v.status === 'scored' ? ` · ${v.score} / ${maxPoints(goal)} points` : goal ? '' : ' · choose a goal for a verdict';
      const rated = core.SCORECARD_IDS.filter((id) => idea.ratings[id] != null).length;
      return `${rated} of ${core.SCORECARD_IDS.length} rated${points}`;
    }
    const ratings = OTHER_IDS.map((c) => idea.ratings[c]).filter((r) => r != null);
    const avg = ratings.length ? ` · average ${fmt(ratings.reduce((a, b) => a + b, 0) / ratings.length)}` : '';
    return `${ratings.length} of ${OTHER_IDS.length} rated${avg} · Average Stars only`;
  }
  function sectionsHTML(idea) {
    return SECTIONS.map(({ id, title, ids }) => {
      const other = id === 'other';
      const head = other
        ? `<button type="button" class="sec-toggle" data-action="toggle-other" aria-expanded="${state.showOther}" aria-controls="criteria-other"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>${title}</button>`
        : `${title}${id === 'gold' ? ' <span class="badge badge-weight">12</span>' : ''}`;
      return `<section class="crit-section" data-section="${id}">
        <div class="sec-head"><h3>${head}</h3><span class="sec-sum" data-sec-sum="${id}">${sectionSummary(id, idea)}</span></div>
        <ol class="criteria"${other ? ` id="criteria-other"${state.showOther ? '' : ' hidden'}` : ''}>${ids.map((cid) => criterionHTML(CRITERIA.find((c) => c.id === cid), idea)).join('')}</ol>
      </section>`;
    }).join('');
  }
  function refreshSections(idea) {
    els.editor.querySelectorAll('[data-sec-sum]').forEach((el) => {
      el.textContent = sectionSummary(el.dataset.secSum, idea);
    });
  }

  // Beside the scorecard on wide screens: where a star counts most, from the
  // same sums Coach uses.
  function railHTML(idea) {
    if (!core.isGoal(idea.goal)) {
      return '<div class="rail-card"><h4>No verdict yet</h4><p class="rail-note">Choose Income or Asset above. The goal sets each gold line\'s weight and the verdict bands.</p></div>';
    }
    const v = core.verdict(idea);
    const goal = core.GOALS[idea.goal];
    const gains = coachLib.analyze(idea).biggestGainsPerStar.slice(0, 3);
    const rows = gains
      .map(
        (g) =>
          `<div class="gain"><span class="gain-line"><b>${escapeHTML(g.name)}</b><span class="gain-meta">${g.stars} star${g.stars === 1 ? '' : 's'} now · weight ×${g.perStar}</span></span><span class="gain-delta">+${g.perStar} a star</span></div>`
      )
      .join('');
    const next = v.status === 'scored' && v.level > 0 ? `<p class="rail-note">${goal.bands[v.level - 1] - v.score} more points make it <b>${escapeHTML(core.VERDICTS[v.level - 1])}</b>.</p>` : '';
    return `<div class="rail-card"><h4>Biggest gains per star</h4>${rows || '<p class="rail-note">Rate the gold lines to see where a star counts most.</p>'}${next}</div>`;
  }

  function setNote(button, open, focus = false) {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    const input = panel.querySelector('textarea');
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? 'Hide note' : input.value.trim() ? 'Show note' : 'Add note';
    if (open && focus) input.focus();
  }

  const toggleNote = (button) => setNote(button, button.getAttribute('aria-expanded') !== 'true', true);

  function setGuide(button, open) {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? button.dataset.hide : button.dataset.show;
  }

  function setSettings(button, open) {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? 'Hide settings' : 'Settings';
  }

  function renderEditor() {
    const idea = selected();
    if (!idea) {
      els.editor.dataset.goal = '';
      els.editor.innerHTML = state.ideas.length
        ? '<div class="empty"><p>Select an idea to rate it.</p></div>'
        : '<div class="empty"><p>Your ideas and their scorecards appear here.</p><button type="button" class="btn btn-primary" data-action="new">New idea</button></div>';
      return;
    }
    const statuses = statusOptions();
    const edited = new Date(idea.updatedAt);
    els.editor.dataset.goal = idea.goal;
    const tab = (name) => (state.ideaTab === name ? '' : ' hidden');
    els.editor.innerHTML = `
      <button type="button" class="btn btn-small btn-ghost scorecard-back" data-action="back">&larr; All ideas</button>
      <div class="idea-head">
        <div class="field field-name">
          <label class="visually-hidden" for="idea-name">Idea name</label>
          <textarea class="idea-name" id="idea-name" rows="1" spellcheck="false" aria-describedby="count-idea-name"${tooLongAttr(idea.name, LIMIT.name)}>${escapeHTML(idea.name)}</textarea>
          ${counterHTML('idea-name', idea.name, LIMIT.name)}
        </div>
        <div class="idea-meta">
          <div class="goal-field" id="goal-panel" data-goal="${escapeHTML(idea.goal)}">
            <span class="visually-hidden" id="goal-label">Goal: Income (you keep working) or Asset (a company you can sell). It sets the weights and the verdict.</span>
            ${goalToggleHTML(idea.goal)}
          </div>
          <label class="field field-status"><span class="visually-hidden">Status</span>
            <select id="idea-status" data-status="${escapeHTML(idea.status)}">${statuses.map((s) => `<option${s === idea.status ? ' selected' : ''}>${escapeHTML(s)}</option>`).join('')}</select>
          </label>
          <label class="field field-tags"><span class="visually-hidden">Tags, comma separated</span>
            <input id="idea-tags" value="${escapeHTML(idea.tags.join(', '))}" autocomplete="off" placeholder="Tags, comma separated" aria-describedby="count-idea-tags"${tooLongAttr(idea.tags.join(', '), LIMIT.tags)}>
            ${counterHTML('idea-tags', idea.tags.join(', '), LIMIT.tags)}
          </label>
          <span class="idea-meta-spacer"></span>
          ${cloud.enabled ? GRILL_BUTTON : ''}
        </div>
        <label class="field field-notes"><span class="field-label">Notes</span>
          <textarea id="idea-notes" rows="2" placeholder="What is the idea, who is it for, and why now?" aria-describedby="count-idea-notes"${tooLongAttr(idea.notes, LIMIT.notes)}>${escapeHTML(idea.notes)}</textarea>
          ${counterHTML('idea-notes', idea.notes, LIMIT.notes)}
        </label>
      </div>
      <div class="readout" id="readout">${readoutHTML(idea)}</div>
      ${ideaTabsHTML(idea)}
      <div class="idea-tab" data-tab-panel="scorecard"${tab('scorecard')}>
        <div class="idea-grid">
          <div class="scorecard-main">
            <div class="criteria-head">
              <div class="criteria-tools">
                <label class="check"><input type="checkbox" id="show-guides"${state.showGuides ? ' checked' : ''}> Show All Guides</label>
                <label class="check"><input type="checkbox" id="show-notes"${state.showNotes ? ' checked' : ''}> Show All Notes</label>
              </div>
            </div>
            ${sectionsHTML(idea)}
          </div>
          <aside class="idea-rail" id="idea-rail" aria-label="Where a star counts most">${railHTML(idea)}</aside>
        </div>
      </div>
      ${cloud.enabled ? `<section class="idea-tab landing-panel landscape-panel" id="landscape-panel" data-tab-panel="competition" aria-labelledby="landscape-title"${tab('competition')}>${landscapeHTML(idea)}</section>` : ''}
      ${cloud.enabled ? `<section class="idea-tab landing-panel" id="landing-panel" data-tab-panel="landing" aria-labelledby="landing-title"${tab('landing')}>${landingHTML(idea)}</section>` : ''}
      <div class="scorecard-foot">
        <span class="stamp">Last edited ${edited.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <div class="confirm idea-actions" id="idea-actions">${ACTIONS_IDLE}</div>
      </div>`;
    fitName();
  }

  // The name field wraps like a heading instead of scrolling sideways.
  function fitName() {
    const name = $('#idea-name');
    if (!name) return;
    name.style.height = 'auto';
    if (name.scrollHeight) name.style.height = name.scrollHeight + 'px';
  }

  function refreshScore(idea) {
    const readout = $('#readout');
    if (readout) readout.innerHTML = readoutHTML(idea);
    refreshSections(idea);
    const rail = $('#idea-rail');
    if (rail) rail.innerHTML = railHTML(idea);
  }

  function refreshCriterion(idea, criterionId) {
    const row = els.editor.querySelector(`[data-criterion-row="${criterionId}"]`);
    if (!row) return;
    const rating = idea.ratings[criterionId] ?? null;
    row.classList.toggle('is-unrated', !rating);
    for (let n = 1; n <= MAX_STARS; n++) row.classList.toggle(`stars-${n}`, rating === n);
    row.querySelectorAll('.star').forEach((btn) => {
      const n = Number(btn.dataset.rate);
      btn.classList.toggle('is-on', !!rating && n <= rating);
      btn.setAttribute('aria-pressed', String(rating === n));
    });
    markBands(row, rating);
  }

  function heat(value) {
    return value == null ? '' : `heat-${Math.min(MAX_STARS, Math.max(1, Math.round(value)))}`;
  }

  // What Compare is set to, as words for `n` ideas: "Income ideas", "1 idea
  // tagged “x”", or just "ideas" when nothing is chosen.
  function compareScope(n) {
    const c = state.compare;
    const ideas = n === 1 ? 'idea' : 'ideas';
    if (!c) return ideas;
    return c.kind === 'goal' ? `${goalLabel(c.value)} ${ideas}` : `${ideas} tagged \u201c${c.value}\u201d`;
  }

  function inCompare(idea) {
    const c = state.compare;
    // Nothing chosen: every idea.
    if (!c) return true;
    return c.kind === 'goal' ? idea.goal === c.value : idea.tags.some((t) => t.toLowerCase() === c.value.toLowerCase());
  }

  // The picker above the table: Income or Asset pressed, a tag chosen, or
  // neither (every idea).
  function renderComparePicker() {
    const c = state.compare;
    const tags = allTags();
    if (c?.kind === 'tag' && !tags.some((t) => t.toLowerCase() === c.value.toLowerCase())) state.compare = null;
    const tag = state.compare?.kind === 'tag' ? state.compare.value : '';
    $('#compare-tag').innerHTML =
      '<option value="">Choose a tag</option>' + tags.map((t) => `<option value="${escapeHTML(t)}"${t === tag ? ' selected' : ''}>${escapeHTML(t)}</option>`).join('');
    $('#compare-goal')
      .querySelectorAll('[data-compare-goal]')
      .forEach((b) => b.setAttribute('aria-pressed', String(state.compare?.kind === 'goal' && state.compare.value === b.dataset.compareGoal)));
  }

  function renderMatrix() {
    renderComparePicker();
    if (!state.ideas.length) {
      els.matrix.innerHTML = '<div class="empty"><p>Add ideas to compare them here.</p></div>';
      return;
    }
    const scoped = state.ideas.filter(inCompare);
    const ideas = visibleIdeas().filter(inCompare);
    const scope = compareScope(scoped.length);
    if (!scoped.length) {
      els.matrix.innerHTML = `<div class="empty compare-empty"><p>${
        state.compare.kind === 'goal' ? `No ${escapeHTML(scope)} yet. Set an idea's goal to ${escapeHTML(goalLabel(state.compare.value))} on its page.` : `No ${escapeHTML(scope)}.`
      }</p></div>`;
      return;
    }
    // Every line: the 4 gates, the 12 gold lines, then the 9 other lines.
    const columns = CRITERIA;
    const kindOf = (c) => (core.isGate(c.id) ? 'gate' : core.SCORECARD_IDS.includes(c.id) ? 'gold' : 'other');
    const GROUP_LABELS = { gate: 'Gates', gold: 'Gold lines · decide the verdict', other: 'Other lines · Average Stars only' };
    const groups = ['gate', 'gold', 'other']
      .map((kind) => [kind, columns.filter((c) => kindOf(c) === kind).length])
      .filter(([, n]) => n)
      .map(([kind, n]) => `<th scope="colgroup" colspan="${n}" class="g-${kind}">${GROUP_LABELS[kind]}</th>`)
      .join('');
    const groupRow = `<tr class="groups"><th class="col-name"></th><th scope="colgroup" colspan="4">Score</th>${groups}</tr>`;
    const head = `<tr><th class="col-name" scope="col">Idea</th><th scope="col">Status</th><th scope="col">Goal</th><th scope="col">Avg stars</th><th scope="col" class="col-wide">Verdict</th>${columns
      .map(
        (c) =>
          `<th scope="col" class="${core.isGate(c.id) ? 'th-gate' : core.SCORECARD_IDS.includes(c.id) ? 'th-gold' : ''}" title="${escapeHTML(
            core.isGate(c.id) ? gateName(c.id) : criterionInfo(c.id).summary || c.name
          )}">${escapeHTML(core.isGate(c.id) ? `Gate ${core.GATE_IDS.indexOf(c.id) + 1}` : c.name)}</th>`
      )
      .join('')}</tr>`;
    const body = ideas
      .map((idea) => {
        const { average } = score(idea);
        return `<tr data-id="${escapeHTML(idea.id)}">
          <th class="col-name" scope="row"><button type="button">${escapeHTML(idea.name)}</button></th>
          <td><span class="pill pill-status" data-status="${escapeHTML(idea.status)}">${escapeHTML(idea.status)}</span></td>
          <td>${goalPill(idea.goal) || '<span class="verdict-note">Not set</span>'}</td>
          <td class="num col-avg">${fmt(average, 2)}</td>
          <td class="col-wide">${verdictHTML(idea, { compact: true })}</td>
          ${columns.map((c) => {
            if (core.isGate(c.id)) {
              const g = idea.gates[c.id];
              return `<td class="num gate-cell${g ? ` gate-${escapeHTML(g)}` : ' empty-cell'}">${g ? (g === 'pass' ? 'Pass' : 'Fail') : '·'}</td>`;
            }
            const r = idea.ratings[c.id];
            const s = setting(c.id, idea);
            const cls = [r ? heat(r) : 'empty-cell', s.enabled ? '' : 'is-off'].filter(Boolean).join(' ');
            const weight = s.weight > 1 ? `<sup>&times;${escapeHTML(s.weight)}</sup>` : '';
            return `<td class="num ${cls}">${escapeHTML(r ?? '·')}${weight}</td>`;
          }).join('')}
        </tr>`;
      })
      .join('');
    const legend = `<div class="legend">Stars ${[1, 2, 3, 4, 5]
      .map((n) => `<i class="heat-${n}">${n}</i>`)
      .join('')}<span>&middot; blank means not rated &middot; &times;3 is the weight &middot; faded means not counted</span></div>`;
    const caption = `<p class="compare-caption"><strong>${scoped.length}</strong> ${escapeHTML(scope)}</p>`;
    // The Ideas tab's search and filters apply here too, so say when they hide ideas.
    const note =
      ideas.length < scoped.length
        ? `<p class="matrix-filter">Showing ${ideas.length} of ${scoped.length} ${escapeHTML(scope)}, filtered on the Ideas tab. <button type="button" class="btn btn-small" data-action="clear-filters">Clear filters</button></p>`
        : '';
    els.matrix.innerHTML =
      caption +
      note +
      (ideas.length
        ? `<div class="matrix-table"><table class="matrix"><thead>${groupRow}${head}</thead><tbody>${body}</tbody></table></div>${legend}`
        : '');
  }

  $('#compare-goal').addEventListener('click', (e) => {
    const button = e.target.closest('[data-compare-goal]');
    if (!button) return;
    const goal = button.dataset.compareGoal;
    state.compare = state.compare?.kind === 'goal' && state.compare.value === goal ? null : { kind: 'goal', value: goal };
    renderMatrix();
  });
  $('#compare-tag').addEventListener('change', (e) => {
    state.compare = e.target.value ? { kind: 'tag', value: e.target.value } : null;
    renderMatrix();
  });

  // Names the focused control so it can be found again after its part of the
  // page is drawn anew: by id, or by the data attributes that identify it.
  const FOCUS_ATTRS = ['data-id', 'data-criterion', 'data-rate', 'data-gate', 'data-value', 'data-action', 'data-draft', 'data-guide', 'data-note-toggle', 'data-settings-toggle', 'data-idea-tab', 'data-set-goal'];
  function focusSelector(el) {
    if (!el || el === document.body) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const attrs = FOCUS_ATTRS.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`);
    return attrs.length ? el.tagName.toLowerCase() + attrs.join('') : null;
  }

  // Runs `render`, then puts focus back on the same control, with the caret
  // where it was, so redrawing doesn't drop keyboard users back to the top.
  function keepFocus(render) {
    const active = document.activeElement;
    const sel = focusSelector(active);
    const caret = typeof active?.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    render();
    if (!sel || active.isConnected) return;
    const again = document.querySelector(sel);
    if (!again) return;
    again.focus({ preventScroll: true });
    if (caret) {
      try {
        again.setSelectionRange(...caret);
      } catch {
        // Not a text field.
      }
    }
  }

  function renderAll() {
    renderFilters();
    renderList();
    renderEditor();
    if (state.view === 'matrix') renderMatrix();
  }

  // Lighter refresh while typing, so the editor keeps focus.
  function refreshOverview() {
    renderList();
    if (state.view === 'matrix') renderMatrix();
  }

  // ---------- Actions ----------

  function select(id, { focusEditor = true } = {}) {
    state.selectedId = id;
    keepFocus(() => {
      renderList();
      renderEditor();
    });
    if (focusEditor && isNarrow()) {
      els.workbench.classList.add('show-editor');
      fitName();
      window.scrollTo({ top: 0 });
    }
  }

  // Adding past the limit is refused, and the list says why.
  function roomFor(adding) {
    if (state.ideas.length + adding <= core.MAX_IDEAS) return true;
    setView('ideas');
    els.workbench.classList.remove('show-editor');
    renderList();
    els.listCount.textContent = `${state.ideas.length}/${core.MAX_IDEAS} ideas: the most an account holds. Delete an idea to add another.`;
    els.listCount.classList.add('is-full');
    return false;
  }

  function newIdea() {
    if (!roomFor(1)) return;
    const idea = core.createIdea({ name: 'Name your idea here' });
    state.ideas.unshift(idea);
    state.query = '';
    state.status = '';
    state.tag = '';
    els.search.value = '';
    save();
    setView('ideas');
    renderFilters();
    select(idea.id);
    const name = $('#idea-name');
    if (name) {
      name.focus();
      name.select();
    }
  }

  function setRating(criterionId, value) {
    const idea = selected();
    if (!idea) return;
    idea.ratings[criterionId] = value;
    touch(idea);
    refreshCriterion(idea, criterionId);
    refreshScore(idea);
    refreshOverview();
  }

  function deleteSelected() {
    const idx = state.ideas.findIndex((i) => i.id === state.selectedId);
    if (idx === -1) return;
    state.ideas.splice(idx, 1);
    save();
    stopOrphanDrafts();
    // A tag or status only that idea had is no longer a filter.
    renderFilters();
    const next = visibleIdeas()[0];
    state.selectedId = next && !isNarrow() ? next.id : null;
    els.workbench.classList.remove('show-editor');
    renderAll();
    (els.list.querySelector('[aria-current="true"]') || els.list.querySelector('.idea-row') || $('#new-idea')).focus();
  }

  function duplicateSelected() {
    const idea = selected();
    if (!idea || !roomFor(1)) return;
    // "(copy)" is added within the name's limit, shortening the name if needed.
    const name = `${[...idea.name].slice(0, LIMIT.name - ' (copy)'.length).join('')} (copy)`;
    const copy = core.createIdea({ ...idea, id: undefined, createdAt: undefined, updatedAt: undefined, example: false, name, ratings: { ...idea.ratings }, ratingNotes: { ...idea.ratingNotes }, tags: [...idea.tags] });
    state.ideas.unshift(copy);
    save();
    renderFilters();
    select(copy.id);
  }

  function setView(view) {
    state.view = view;
    const views = { ideas: [els.tabIdeas, els.workbench], matrix: [els.tabMatrix, els.matrixView], coach: [els.tabCoach, $('#view-coach')] };
    // While Settings shows, no sidebar tab is selected, but one stays in the
    // Tab order (the view Settings came from, or Ideas), so the keyboard can
    // still reach the sidebar and its arrow keys.
    const tabbed = view in views ? view : settings.from in views ? settings.from : 'ideas';
    for (const [name, [tab, panel]] of Object.entries(views)) {
      tab.setAttribute('aria-selected', String(name === view));
      tab.tabIndex = name === tabbed ? 0 : -1;
      panel.hidden = name !== view;
    }
    // Settings is the gear in the top bar, pressed while it shows.
    els.tabSettings.setAttribute('aria-pressed', String(view === 'settings'));
    els.settingsView.hidden = view !== 'settings';
    if (view === 'matrix') renderMatrix();
    else if (view === 'coach') {
      renderCoach();
      scrollCoach();
    } else if (view === 'settings') renderSettings();
    // The name was sized while hidden, so size it again now it shows.
    else fitName();
  }

  // The tabs that show: Coach only with accounts on.
  const viewTabs = () => [els.tabIdeas, els.tabMatrix, els.tabCoach].filter((t) => !t.hidden);
  const VIEW_OF_TAB = new Map([
    ['tab-ideas', 'ideas'],
    ['tab-matrix', 'matrix'],
    ['tab-coach', 'coach'],
  ]);

  // ---------- Events ----------

  els.tabIdeas.addEventListener('click', () => setView('ideas'));
  els.tabMatrix.addEventListener('click', () => setView('matrix'));
  els.tabCoach.addEventListener('click', () => setView('coach'));
  els.tabSettings.addEventListener('click', () => {
    settings.from = null;
    setView('settings');
  });
  els.tabCoach.hidden = !cloud.enabled;
  // Arrow keys, Home and End move between the tabs (the sidebar is vertical,
  // the phone's bar horizontal, so both pairs of arrows work).
  $('.tabs').addEventListener('keydown', (e) => {
    const tabs = viewTabs();
    const at = tabs.indexOf(e.target);
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (at === -1 || to === undefined) return;
    e.preventDefault();
    const tab = tabs[(to + tabs.length) % tabs.length];
    settings.from = null;
    setView(VIEW_OF_TAB.get(tab.id));
    tab.focus();
  });
  $('#new-idea').addEventListener('click', newIdea);

  // ---------- Theme ----------
  // Follows the system unless a theme is chosen with the switch in the top
  // bar. The choice is this browser's, not the account's.
  const THEME_KEY = 'ideation-calculator/theme';
  const themeSwitch = $('#theme-switch');
  function applyTheme(choice) {
    const theme = ['light', 'dark', 'halloween'].includes(choice) ? choice : '';
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    const dark = theme ? theme !== 'light' : matchMedia('(prefers-color-scheme: dark)').matches;
    $('meta[name="theme-color"]').setAttribute('content', theme === 'halloween' ? '#140a1f' : dark ? '#0a0e15' : '#2140c7');
    themeSwitch.querySelectorAll('[data-theme-choice]').forEach((b) => {
      const on = b.dataset.themeChoice === (theme || 'system');
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }
  themeSwitch.addEventListener('click', (e) => {
    const button = e.target.closest('[data-theme-choice]');
    if (!button) return;
    applyTheme(button.dataset.themeChoice);
    try {
      localStorage.setItem(THEME_KEY, button.dataset.themeChoice);
    } catch {
      // Not remembered this time.
    }
  });
  themeSwitch.addEventListener('keydown', moveRadio);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(document.documentElement.dataset.theme || ''));
  try {
    applyTheme(localStorage.getItem(THEME_KEY) || '');
  } catch {
    applyTheme('');
  }

  els.search.addEventListener('input', () => {
    state.query = els.search.value;
    refreshOverview();
  });
  els.filterStatus.addEventListener('change', () => {
    state.status = els.filterStatus.value;
    refreshOverview();
  });
  els.filterTag.addEventListener('change', () => {
    state.tag = els.filterTag.value;
    refreshOverview();
  });
  els.sort.addEventListener('change', () => {
    state.sort = els.sort.value;
    save();
    refreshOverview();
  });

  els.list.addEventListener('mousedown', () => {
    listPress.down = true;
  });
  document.addEventListener('mouseup', () => {
    if (!listPress.down) return;
    // After the click that follows this mouseup.
    setTimeout(() => {
      listPress.down = false;
      if (listPress.stale) {
        listPress.stale = false;
        renderList();
      }
    });
  });

  els.list.addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row) return select(row.dataset.id);
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'new') newIdea();
    if (action === 'clear-filters') clearFilters();
  });

  function clearFilters() {
    state.query = state.status = state.tag = '';
    els.search.value = '';
    renderFilters();
    refreshOverview();
  }

  els.matrix.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="clear-filters"]')) return clearFilters();
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    setView('ideas');
    select(row.dataset.id);
  });

  // ---------- Criteria settings ----------

  function settingsChanged(criterionId) {
    const idea = selected();
    touch(idea);
    refreshScore(idea);
    if (criterionId) {
      const row = els.editor.querySelector(`[data-criterion-row="${criterionId}"]`);
      const c = CRITERIA.find((x) => x.id === criterionId);
      row.classList.toggle('is-off', !setting(criterionId).enabled);
      row.querySelector('.criterion-title').innerHTML = titleHTML(c);
      row.querySelector('.criterion-badge').innerHTML = cbadgeHTML(c);
    }
    refreshOverview();
  }

  // Answers a gate Pass or Fail, updating the switch in place so it slides.
  function setGate(id, value) {
    const idea = selected();
    // Only the values sanitizeIdea allows, since they are written into the page.
    if (!idea || !core.isGate(id) || !core.GATE_VALUES.includes(value) || idea.gates[id] === value) return;
    idea.gates[id] = value;
    touch(idea);
    const toggle = els.editor.querySelector(`[data-gate-toggle="${id}"]`);
    toggle.dataset.value = value;
    markRadios(toggle, (b) => b.dataset.value === value);
    const row = els.editor.querySelector(`[data-criterion-row="${id}"]`);
    row.classList.remove('is-unrated', 'gate-pass', 'gate-fail');
    row.classList.add(`gate-${value}`);
    refreshScore(idea);
    refreshOverview();
  }

  // Switches the goal in place, so the toggle can slide, and moves the 12
  // scorecard weights to the new goal's values.
  function changeGoal(goal) {
    const idea = selected();
    if (!idea || idea.goal === goal) return;
    core.setGoal(idea, goal);
    touch(idea);
    els.editor.dataset.goal = goal;
    $('#goal-panel').dataset.goal = goal;
    const toggle = $('#goal-toggle');
    toggle.dataset.goal = goal;
    markRadios(toggle, (b) => b.dataset.setGoal === goal);
    for (const id of core.SCORECARD_IDS) {
      const weight = setting(id).weight;
      const input = $(`#weight-${id}`);
      input.value = weight;
      input.parentElement.querySelector('.weight-value').textContent = `×${weight}`;
      const c = CRITERIA.find((x) => x.id === id);
      const row = els.editor.querySelector(`[data-criterion-row="${id}"]`);
      row.querySelector('.criterion-title').innerHTML = titleHTML(c);
      row.querySelector('.criterion-badge').innerHTML = cbadgeHTML(c);
    }
    refreshScore(idea);
    refreshOverview();
  }

  els.editor.addEventListener('click', (e) => {
    const goalButton = e.target.closest('[data-set-goal]');
    if (goalButton) return changeGoal(goalButton.dataset.setGoal);
    const gateButton = e.target.closest('[data-gate]');
    if (gateButton) return setGate(gateButton.dataset.gate, gateButton.dataset.value);
    const noteToggle = e.target.closest('[data-note-toggle]');
    if (noteToggle) return toggleNote(noteToggle);
    const settingsToggle = e.target.closest('[data-settings-toggle]');
    if (settingsToggle) return setSettings(settingsToggle, settingsToggle.getAttribute('aria-expanded') !== 'true');
    const toggle = e.target.closest('[data-guide]');
    if (toggle) return setGuide(toggle, toggle.getAttribute('aria-expanded') !== 'true');
    const star = e.target.closest('[data-rate]');
    if (star) return setRating(star.dataset.criterion, Number(star.dataset.rate));
    const ideaTab = e.target.closest('[data-idea-tab]');
    if (ideaTab) return setIdeaTab(ideaTab.dataset.ideaTab);
    const action = e.target.closest('[data-action]')?.dataset.action;
    const actions = $('#idea-actions');
    switch (action) {
      case 'new':
        return newIdea();
      case 'back':
        els.workbench.classList.remove('show-editor');
        return;
      case 'toggle-other': {
        state.showOther = !state.showOther;
        save();
        const button = e.target.closest('[data-action]');
        button.setAttribute('aria-expanded', String(state.showOther));
        $('#criteria-other').hidden = !state.showOther;
        return;
      }
      case 'ask-reset':
        actions.dataset.asked = 'ask-reset';
        actions.innerHTML = `<p>Reset this idea? Every line goes to 1★, gates are cleared, and settings go to the ${
          goalLabel(selected().goal) ? `${goalLabel(selected().goal)} ` : ''
        }defaults. Notes, name, status, tags and goal stay.</p><button type="button" class="btn btn-small" data-action="keep">Keep</button><button type="button" class="btn btn-small btn-danger-solid" data-action="reset-settings">Reset to default</button>`;
        actions.querySelector('[data-action="keep"]').focus();
        return;
      case 'reset-settings':
        core.resetToDefault(selected());
        touch(selected());
        renderEditor();
        refreshOverview();
        $('[data-action="ask-reset"]').focus();
        return;
      case 'duplicate':
        return duplicateSelected();
      case 'grill':
        return grillIdea(selected());
      case 'ask-delete':
        actions.dataset.asked = 'ask-delete';
        actions.innerHTML =
          '<p>Delete this idea?</p><button type="button" class="btn btn-small" data-action="keep">Keep it</button><button type="button" class="btn btn-small btn-danger-solid" data-action="delete">Delete</button>';
        actions.querySelector('[data-action="keep"]').focus();
        return;
      case 'keep':
        actions.innerHTML = ACTIONS_IDLE;
        actions.querySelector(`[data-action="${actions.dataset.asked}"]`)?.focus();
        return;
      case 'delete':
        return deleteSelected();
      case 'landing-generate':
        return generateLanding();
      case 'landing-key':
        return openSettings({ focus: '#ai-model' });
      case 'landing-copy':
        return copyLandingLink();
      case 'landing-ask-unpublish':
        landing.asking = { ideaId: selected().id, action: 'unpublish' };
        renderLanding();
        $('[data-action="landing-keep"]')?.focus();
        return;
      case 'draft-ask-delete': {
        const draftId = e.target.closest('[data-draft]').dataset.draft;
        landing.asking = { ideaId: selected().id, action: 'delete', draftId };
        renderLanding();
        $(`[data-action="landing-keep"][data-draft="${CSS.escape(draftId)}"]`)?.focus();
        return;
      }
      case 'landing-keep': {
        const was = landing.asking;
        landing.asking = null;
        renderLanding();
        $(was?.draftId ? `[data-action="draft-ask-delete"][data-draft="${CSS.escape(was.draftId)}"]` : '[data-action="landing-ask-unpublish"]')?.focus();
        return;
      }
      case 'draft-copy':
        return copyDraftLink(e.target.closest('[data-draft]').dataset.draft);
      case 'draft-link':
        return toggleDraftLink(e.target.closest('[data-draft]').dataset.draft);
      case 'draft-production':
        return makeProduction(e.target.closest('[data-draft]').dataset.draft);
      case 'draft-delete':
        return deleteDraft(e.target.closest('[data-draft]').dataset.draft);
      case 'landing-unpublish':
        return unpublishProduction();
      case 'landing-republish':
        return republishProduction();
      case 'landing-reload':
        return loadLandingPages();
    }
    if (action?.startsWith('landscape-')) return landscapeAction(action, e.target.closest('[data-action]'));
  });

  els.editor.addEventListener('input', (e) => {
    if (e.target.dataset.weight) {
      const id = e.target.dataset.weight;
      setting(id).weight = Number(e.target.value);
      e.target.parentElement.querySelector('.weight-value').textContent = `×${e.target.value}`;
      return settingsChanged(id);
    }
    const idea = selected();
    if (!idea) return;
    if (e.target.id === 'idea-name') {
      e.target.value = e.target.value.replace(/[\r\n]+/g, ' ');
      fitName();
    }
    // Over the limit: the idea keeps its last text within the limit.
    if (!checkLength(e.target)) return;
    if (e.target.dataset.note) {
      const id = e.target.dataset.note;
      if (e.target.value.trim()) idea.ratingNotes[id] = core.cleanText(e.target.value);
      else delete idea.ratingNotes[id];
      touch(idea);
      return;
    }
    if (e.target.id === 'idea-name') idea.name = core.cleanText(e.target.value);
    else if (e.target.id === 'idea-notes') idea.notes = core.cleanText(e.target.value);
    // Saved as they are typed; tidied when the field is left.
    else if (e.target.id === 'idea-tags') idea.tags = core.normalizeTags(e.target.value);
    else return;
    touch(idea);
    refreshOverview();
  });

  els.editor.addEventListener('keydown', (e) => {
    if (e.target.id === 'idea-name' && e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
    moveIdeaTab(e);
    moveRadio(e);
  });

  // The idea's tabs take one Tab stop, like the sidebar's: arrow keys, Home
  // and End move between them and show the tab's panel.
  function moveIdeaTab(e) {
    const tab = e.target.closest('[data-idea-tab]');
    if (!tab) return;
    const tabs = [...els.editor.querySelectorAll('[data-idea-tab]')];
    const at = tabs.indexOf(tab);
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    setIdeaTab(next.dataset.ideaTab);
    next.focus();
  }

  // Arrow keys choose the next or previous option of a switch made of radio
  // buttons (goal, gate), as in any radio group.
  function moveRadio(e) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const radio = e.target.closest('[role="radio"]');
    if (!radio || !step) return;
    e.preventDefault();
    const radios = [...radio.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]')];
    const next = radios[(radios.indexOf(radio) + step + radios.length) % radios.length];
    next.click();
    next.focus();
  }

  window.addEventListener('resize', fitName);

  els.editor.addEventListener('change', (e) => {
    if (e.target.id === 'show-guides') {
      state.showGuides = e.target.checked;
      els.editor.querySelectorAll('[data-guide]').forEach((b) => setGuide(b, state.showGuides));
      save();
      return;
    }
    if (e.target.id === 'show-notes') {
      state.showNotes = e.target.checked;
      // Turning it off leaves notes that have text open, as they are by default.
      els.editor.querySelectorAll('[data-note-toggle]').forEach((b) => {
        const text = document.getElementById(b.getAttribute('aria-controls'))?.querySelector('textarea').value.trim();
        setNote(b, state.showNotes || !!text);
      });
      save();
      return;
    }
    const { counts, fail } = e.target.dataset;
    if (counts) {
      setting(counts).enabled = e.target.checked;
      return settingsChanged(counts);
    }
    if (fail) {
      setting(fail).failVerdict = e.target.checked;
      return settingsChanged(fail);
    }
    const idea = selected();
    if (!idea) return;
    if (e.target.dataset.unsaved) return;
    if (e.target.id === 'idea-name') {
      idea.name = core.cleanText(e.target.value).trim() || 'Name your idea here';
      e.target.value = idea.name;
    } else if (e.target.id === 'idea-status') {
      idea.status = e.target.value;
      e.target.dataset.status = idea.status;
    } else if (e.target.id === 'idea-tags') {
      idea.tags = core.normalizeTags(e.target.value);
      e.target.value = idea.tags.join(', ');
    } else {
      return;
    }
    touch(idea);
    renderFilters();
    refreshOverview();
  });

  $('#remove-examples').addEventListener('click', () => {
    state.ideas = state.ideas.filter((i) => !i.example);
    stopOrphanDrafts();
    if (!selected()) {
      state.selectedId = isNarrow() ? null : visibleIdeas()[0]?.id ?? null;
      els.workbench.classList.remove('show-editor');
    }
    save();
    renderAll();
  });

  // ---------- Export ----------

  const exportDialog = $('#export-dialog');
  const exportText = $('#export-text');
  const exportStatus = $('#export-status');

  function openExport() {
    exportText.value = core.toBackup(state.ideas);
    exportStatus.textContent = '';
    exportDialog.showModal();
  }
  $('#open-export').addEventListener('click', openExport);

  $('#copy-export').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(exportText.value);
      exportStatus.textContent = 'Copied';
    } catch {
      exportText.focus();
      exportText.select();
      exportStatus.textContent = 'Text selected. Press Ctrl+C or ⌘C to copy.';
    }
  });

  $('#download-export').addEventListener('click', () => {
    const blob = new Blob([exportText.value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ideation-calculator-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    exportStatus.textContent = 'Download started. If nothing saved, use Copy.';
  });

  // ---------- Landing pages ----------

  // Each idea can have public landing pages, written by the chosen AI model
  // from its name, tags and notes, and served by the site's Worker
  // (worker.mjs). Every page the model writes is kept as a draft (up to
  // landingLib.ACCOUNT_DRAFT_LIMIT in the account, on any of its ideas) with
  // its own address, /p/<slug>/<code>, so pages from several models can be
  // compared and shared. The one made production is copied to the idea's own
  // address, /p/<slug>, which is given with the first draft and kept for as
  // long as the idea: unpublishing only takes the page offline, and publishing
  // it again brings it back as it was. An account keeps up to
  // landingLib.ACCOUNT_PAGE_LIMIT production pages (published or not).
  // Only with accounts on: pages and drafts are kept in the account.
  const landing = {
    pages: null, // idea id -> { slug, publishedAt, draftId, published }, once loaded
    drafts: new Map(), // idea id -> [{ id, model, createdAt, code, published }], newest first
    html: new Map(), // draft id -> its HTML, once loaded to make it production
    loadError: '',
    busy: new Map(), // idea id -> how far its new draft has got, while it is written
    stops: new Map(), // idea id -> the AbortController that stops its draft, while it is written
    working: new Set(), // draft ids being made production, published, unpublished or deleted
    changing: new Set(), // ideas whose production page is changing: nothing else may change it meanwhile
    messages: new Map(), // idea id -> { text, kind }
    asking: null, // { ideaId, action: 'unpublish' | 'delete', draftId } waiting for a yes
    refreshing: false, // checking for pages and drafts changed on another device
    changes: 0, // counts changes made here, so an older check can't undo them
  };

  // The model each feature runs on, kept in this browser only, per account.
  // Landing pages, Coach and competition reviews each keep their own choice
  // under their own name (the landing pages' dates from when Meta was the
  // only provider). The items once held the API keys too: a key still found
  // there is never read, and the item is written again without it.
  function modelStore(prefix) {
    const name = () => prefix + (account?.id || '');
    return {
      read() {
        try {
          const saved = JSON.parse(localStorage.getItem(name()) || '{}');
          const model = landingLib.modelInfo(saved.model) ? saved.model : landingLib.DEFAULT_MODEL;
          if ('keys' in saved || 'key' in saved) localStorage.setItem(name(), JSON.stringify({ model }));
          return { model };
        } catch {
          return { model: landingLib.DEFAULT_MODEL };
        }
      },
      // Throws when the browser won't keep it.
      write: (model) => localStorage.setItem(name(), JSON.stringify({ model })),
    };
  }

  // The API Vault: the person's own API key for each provider (Meta), kept
  // in this browser only, never sent to the account, and used by landing
  // pages, Coach and competition reviews alike. Each account keeps its own, so
  // on a shared browser one person's keys aren't used for another's. A key
  // for a provider the app no longer offers is deleted from the browser the
  // first time the Vault is read.
  const VAULT_STORE = 'ideation-calculator/api-vault/';
  const vault = {
    read() {
      try {
        const saved = JSON.parse(localStorage.getItem(VAULT_STORE + (account?.id || '')) || '{}');
        const stored = saved.keys && typeof saved.keys === 'object' ? saved.keys : {};
        const keys = {};
        for (const id of Object.keys(landingLib.PROVIDERS)) if (typeof stored[id] === 'string' && stored[id]) keys[id] = stored[id];
        if (Object.keys(stored).some((id) => !(id in keys))) vault.write(keys);
        return keys;
      } catch {
        return {};
      }
    },
    // Throws when the browser won't keep it.
    write(keys) {
      const name = VAULT_STORE + (account?.id || '');
      if (Object.keys(keys).length) localStorage.setItem(name, JSON.stringify({ keys }));
      else localStorage.removeItem(name);
    },
    // Removes one vendor's key.
    forget(vendor) {
      try {
        const keys = vault.read();
        delete keys[vendor];
        vault.write(keys);
      } catch {
        // Nothing was kept.
      }
    },
  };
  const landingKeys = modelStore('ideation-calculator/meta-model-api/');
  const aiSettings = () => landingKeys.read();
  const providerOf = (model) => landingLib.PROVIDERS[landingLib.modelInfo(model).provider];

  const pageURL = (slug, code) => new URL(code ? `/p/${slug}/${code}` : `/p/${slug}`, location.origin).href;
  const shortURL = (url) => url.replace(/^https?:\/\//, '');
  // A model's label; a draft or review made with a model the app no longer offers says so.
  const modelLabel = (id) => (landingLib.MODELS.find((m) => m.id === id)?.label || 'an earlier model').replace(/ \(.*\)$/, '');
  const when = (date) => new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const draftsOf = (ideaId) => landing.drafts.get(ideaId) || [];
  // What the account holds, out of what it may: only ideas still here, as
  // deleting an idea deletes its drafts and page with it. A production page
  // counts while it is kept, published or not: `publishedAt` is set exactly
  // when the page has HTML.
  const accountDrafts = () => state.ideas.reduce((n, i) => n + draftsOf(i.id).length, 0);
  const accountPages = () => state.ideas.filter((i) => landing.pages?.get(i.id)?.publishedAt).length;
  const DRAFTS_FULL = `${landingLib.ACCOUNT_DRAFT_LIMIT} drafts is the most an account keeps in all. Delete some, on this idea or others, to make more.`;
  const PAGES_FULL = `${landingLib.ACCOUNT_PAGE_LIMIT} production pages is the most an account keeps. Unpublish and delete ideas you no longer need.`;

  // Why no draft can be made for this idea now, or '': checked before the
  // model is asked, so nobody pays for a page the database would refuse.
  const draftLimitText = () => (accountDrafts() >= landingLib.ACCOUNT_DRAFT_LIMIT ? DRAFTS_FULL : '');
  // Why no draft of this idea can be made production now, or '': an idea
  // with a production page already can always replace it.
  const pageLimitText = (ideaId) => (!landing.pages?.get(ideaId)?.publishedAt && accountPages() >= landingLib.ACCOUNT_PAGE_LIMIT ? PAGES_FULL : '');

  function progressText({ model, characters, thinking }) {
    if (characters) return `Writing a draft with ${modelLabel(model)}… ${characters.toLocaleString()} characters so far.`;
    return `${thinking ? 'Planning' : 'Starting'} a draft with ${modelLabel(model)}… This can take a minute or two.`;
  }

  function draftHTML(idea, draft, page) {
    const production = page?.draftId === draft.id;
    const asking = landing.asking?.action === 'delete' && landing.asking.draftId === draft.id;
    const busy = landing.working.has(draft.id);
    const changing = landing.changing.has(idea.id);
    const full = pageLimitText(idea.id);
    const id = escapeHTML(draft.id);
    const linked = draft.published && page;
    const link = linked
      ? `<a class="landing-draft-link" href="${escapeHTML(pageURL(page.slug, draft.code))}" target="_blank" rel="noopener">${escapeHTML(shortURL(pageURL(page.slug, draft.code)))}</a>`
      : '<span class="landing-draft-link is-off">Link unpublished</span>';
    const actions = asking
      ? `<p>Delete this draft? Its link stops working.${production ? ' The production page stays up.' : ''}</p><button type="button" class="btn btn-small" data-action="landing-keep" data-draft="${id}">Keep it</button><button type="button" class="btn btn-small btn-danger-solid" data-action="draft-delete" data-draft="${id}">Delete</button>`
      : (linked ? `<button type="button" class="btn btn-small" data-action="draft-copy" data-draft="${id}">Copy link</button>` : '') +
        // Not disabled while busy (a second click is ignored), so it keeps the focus.
        `<button type="button" class="btn btn-small" data-action="draft-link" data-draft="${id}">${linked ? 'Unpublish' : 'Publish'}</button>` +
        (production && page.published ? '' : `<button type="button" class="btn btn-small btn-primary" data-action="draft-production" data-draft="${id}"${busy || changing || full ? ' disabled' : ''}${full ? ` title="${escapeHTML(full)}"` : ''}>Make production</button>`) +
        `<button type="button" class="btn btn-small btn-ghost btn-danger" data-action="draft-ask-delete" data-draft="${id}"${busy ? ' disabled' : ''}>Delete</button>`;
    return (
      `<li class="landing-draft${production ? ' is-production' : ''}" data-draft-row="${id}">` +
      '<span class="draft-thumb" aria-hidden="true"><i class="h"></i><i></i><i class="s"></i><i class="c"></i><span class="cols"><i></i><i></i><i></i></span></span>' +
      '<span class="draft-body">' +
      `<span class="landing-draft-name">${escapeHTML(modelLabel(draft.model))}${production ? ' <span class="pill pill-live">Production</span>' : ''}</span>` +
      `<span class="landing-date">${escapeHTML(when(draft.createdAt))}</span>` +
      `<span class="landing-draft-where">${linked ? '<span class="pill pill-linked">Live</span> ' : ''}${link}</span>` +
      `<span class="landing-actions confirm">${actions}</span></span></li>`
    );
  }

  // The idea's own address and what is there: nothing yet, the production
  // page, or that page taken offline.
  function productionHTML(idea, page) {
    const url = pageURL(page.slug);
    const changing = landing.changing.has(idea.id);
    const from = draftsOf(idea.id).find((d) => d.id === page.draftId);
    const copy = '<button type="button" class="btn btn-small" data-action="landing-copy">Copy link</button>';
    let status;
    let actions = copy;
    if (!page.publishedAt) {
      status = `Production address: <span id="landing-link">${escapeHTML(shortURL(url))}</span> <span class="landing-date">Nothing here yet: make a draft production to put it at this address.</span>`;
    } else if (page.published) {
      status =
        `Production: live at <a href="${escapeHTML(url)}" target="_blank" rel="noopener" id="landing-link">${escapeHTML(shortURL(url))}</a> ` +
        `<span class="landing-date">Since ${escapeHTML(when(page.publishedAt))}${from ? `, from the ${escapeHTML(modelLabel(from.model))} draft` : ''}</span>`;
      actions =
        landing.asking?.action === 'unpublish' && landing.asking.ideaId === idea.id
          ? "<p>Unpublish the production page? Its address, and the link of the draft it came from, stop working until you publish them again; the address stays this idea's.</p><button type=\"button\" class=\"btn btn-small\" data-action=\"landing-keep\">Keep it</button><button type=\"button\" class=\"btn btn-small btn-danger-solid\" data-action=\"landing-unpublish\">Unpublish</button>"
          : copy + `<button type="button" class="btn btn-small btn-danger" data-action="landing-ask-unpublish"${changing ? ' disabled' : ''}>Unpublish</button>`;
    } else {
      status = `Production: unpublished. <span id="landing-link">${escapeHTML(shortURL(url))}</span> <span class="landing-date">Publish it again to bring the page back as it was.</span>`;
      actions = copy + `<button type="button" class="btn btn-small btn-primary" data-action="landing-republish"${changing ? ' disabled' : ''}>Publish again</button>`;
    }
    return `<div class="live-card${page.published ? '' : ' is-off'}"><span class="live-globe" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span><p class="landing-live${page.published ? '' : ' is-off'}">${status}</p><div class="landing-actions confirm">${actions}</div></div>`;
  }

  function landingHTML(idea) {
    const head =
      '<div class="landing-head"><h3 id="landing-title">Landing page</h3>' +
      "<p>A public one-page website for this idea, written from its name, tags and notes, including each line's note. Every draft gets a link of its own; make the one you like production to put it at the idea's own address, which never changes.</p></div>";
    if (!landing.pages) {
      return (
        head +
        (landing.loadError
          ? `<p class="landing-message is-error">Landing pages could not be loaded (${escapeHTML(landing.loadError)}).</p><div class="landing-actions"><button type="button" class="btn btn-small" data-action="landing-reload">Try again</button></div>`
          : '<p class="landing-message">Loading…</p>')
      );
    }
    const message = landing.messages.get(idea.id);
    const note = `<p class="landing-message${message ? ` is-${message.kind}` : ''}" role="status">${escapeHTML(message?.text || '')}</p>`;
    const page = landing.pages.get(idea.id);
    const drafts = draftsOf(idea.id);
    const production = page ? productionHTML(idea, page) : '';
    const { model } = aiSettings();
    const generate = landing.busy.has(idea.id)
      ? `<p class="landing-message is-busy" id="landing-progress">${escapeHTML(progressText(landing.busy.get(idea.id)))}</p>`
      : '<div class="landing-actions">' +
        '<button type="button" class="btn btn-small btn-ghost" data-action="landing-key">Model</button>' +
        `<button type="button" class="btn btn-small btn-primary" data-action="landing-generate"${draftLimitText() ? ' disabled' : ''}>Generate a draft with ${escapeHTML(modelLabel(model))}</button>` +
        (draftLimitText() ? `<p class="landing-hint">${escapeHTML(draftLimitText())}</p>` : '') +
        '</div>';
    const toolbar = `<div class="panel-toolbar">${usageTitleHTML('Drafts', drafts.length, accountDrafts(), landingLib.ACCOUNT_DRAFT_LIMIT)}${generate}</div>`;
    const full = drafts.length && pageLimitText(idea.id) ? `<p class="landing-hint">${escapeHTML(pageLimitText(idea.id))}</p>` : '';
    const list = drafts.length ? `<ul class="landing-drafts">${drafts.map((d) => draftHTML(idea, d, page)).join('')}</ul>` : '';
    return head + production + toolbar + full + list + note;
  }

  // A tab's heading: how many the idea has, and how many the account holds
  // out of the most it keeps; red at the limit.
  function usageTitleHTML(what, own, all, limit) {
    return `<h4 class="landing-drafts-title${all >= limit ? ' is-full' : ''}">${what} (${own}) <span class="usage-account">· ${all}/${limit} in account</span></h4>`;
  }

  function renderLanding() {
    const panel = $('#landing-panel');
    const idea = selected();
    if (panel && idea) keepFocus(() => (panel.innerHTML = landingHTML(idea)));
    refreshIdeaTabCounts();
    renderUsage();
  }

  function setLandingMessage(ideaId, text, kind = 'ok') {
    if (text) landing.messages.set(ideaId, { text, kind });
    else landing.messages.delete(ideaId);
    if (selected()?.id === ideaId) renderLanding();
  }

  async function loadLandingPages() {
    const epoch = authEpoch;
    landing.pages = null;
    landing.loadError = '';
    renderLanding();
    try {
      const [pages, drafts] = await Promise.all([cloud.loadPages(), cloud.loadDrafts()]);
      if (epoch !== authEpoch) return;
      landing.pages = pages;
      landing.drafts = drafts;
    } catch (err) {
      if (epoch !== authEpoch) return;
      landing.loadError = err.message;
    }
    renderLanding();
  }

  // Coming back to the tab: pages and drafts changed on another device show
  // here too. The panel isn't emptied while they load, and is only drawn
  // again when something changed.
  async function refreshLandingPages() {
    if (!signedIn || !landing.pages || landing.refreshing) return;
    landing.refreshing = true;
    const epoch = authEpoch;
    const changes = landing.changes;
    try {
      const [pages, drafts] = await Promise.all([cloud.loadPages(), cloud.loadDrafts()]);
      // Something changed here while this check was out, so its answer is
      // older than what this tab has: drop it, the next return checks again.
      if (epoch !== authEpoch || !landing.pages || landing.changes !== changes) return;
      const snapshotOf = (p, d) => JSON.stringify([[...p].sort(), [...d].sort()]);
      const before = snapshotOf(landing.pages, landing.drafts);
      landing.pages = pages;
      landing.drafts = drafts;
      if (snapshotOf(pages, drafts) !== before) renderLanding();
    } catch {
      // Offline or signed out; the next return tries again.
    } finally {
      landing.refreshing = false;
    }
  }

  // Stops writing drafts for ideas no longer in this tab (deleted, replaced
  // by an import, or found deleted on another device): nobody would see
  // them, and the model would go on writing, and billing for, them. Signing
  // out stops them all. Called wherever ideas leave the list.
  function stopOrphanDrafts(all = false) {
    for (const [id, controller] of landing.stops) if (all || !state.ideas.some((i) => i.id === id)) controller.abort();
    // Reviews of those ideas too.
    stopOrphanReviews(all);
  }

  function forgetLanding() {
    stopOrphanDrafts(true);
    Object.assign(landing, {
      pages: null,
      drafts: new Map(),
      html: new Map(),
      loadError: '',
      busy: new Map(),
      stops: new Map(),
      working: new Set(),
      changing: new Set(),
      messages: new Map(),
      asking: null,
      refreshing: false,
      changes: 0,
    });
  }

  // `who` is the model's provider, for example "Meta".
  function generateErrorText(err, who) {
    if (err.code === 'NO_SESSION') return 'You are not signed in right now. Sign in again, then try again.';
    if (err.vendorStatus === 401 || err.vendorStatus === 403) return `${who} refused the API key (${err.message}). Check it in Settings.`;
    if (err.vendorStatus === 429) return `${who}'s usage limit was reached (${err.message}). Try again later.`;
    if (err.vendorStatus) return `${who}'s API answered with an error: ${err.message}`;
    return err.message;
  }

  // The idea's address, given the first time it is needed and kept from then
  // on: by the idea's first draft, or an older draft's link being published.
  async function pageAddress(idea) {
    if (landing.pages.has(idea.id)) return landing.pages.get(idea.id);
    let page;
    try {
      page = await cloud.savePageAddress(idea.id, landingLib.slugFor(idea.name, landingLib.randomPart()));
    } catch (err) {
      // Another idea has this address: take another.
      if (err.code !== '23505') throw err;
      page = await cloud.savePageAddress(idea.id, landingLib.slugFor(idea.name, landingLib.randomPart()));
    }
    // Another tab or device may have made the production page meanwhile:
    // what the database returned is what is there.
    landing.pages.set(idea.id, page);
    landing.changes++;
    return page;
  }

  // Writes a new draft with the chosen model and publishes it at its own
  // address. The production page isn't touched.
  async function generateLanding() {
    const idea = selected();
    if (!idea || !landing.pages || landing.busy.has(idea.id)) return;
    const { model } = aiSettings();
    const provider = providerOf(model);
    const key = vault.read()[landingLib.modelInfo(model).provider];
    if (!key) return openVault(`Add your ${provider.name} key to generate a page with ${modelLabel(model)}.`, landingLib.modelInfo(model).provider);
    if (!landingLib.hasNotes(idea)) {
      return setLandingMessage(idea.id, 'Write some notes first: what the idea is, who it is for and why now. The page is written from them.', 'error');
    }
    if (draftLimitText()) return setLandingMessage(idea.id, draftLimitText(), 'error');
    const epoch = authEpoch;
    const controller = new AbortController();
    landing.busy.set(idea.id, { model, characters: 0, thinking: false });
    landing.stops.set(idea.id, controller);
    landing.messages.delete(idea.id);
    renderLanding();
    const gone = () => !state.ideas.some((i) => i.id === idea.id);
    // Updates the progress line in place, so the panel isn't redrawn on every piece.
    const onProgress = (progress) => {
      if (epoch !== authEpoch || !landing.busy.has(idea.id)) return;
      if (gone()) return controller.abort();
      const now = { model, ...progress };
      landing.busy.set(idea.id, now);
      if (selected()?.id === idea.id) {
        const line = $('#landing-progress');
        if (line) line.textContent = progressText(now);
      }
    };
    let message = null;
    try {
      // A draft belongs to the idea's saved row, so the idea is saved first.
      // Only this idea has to be: another idea the database refused doesn't matter.
      await flushSync();
      if (sync.synced.get(idea.id) !== JSON.stringify(idea)) {
        throw new Error(
          sync.refused.has(idea.id)
            ? "This idea can't be saved to your account, so it can't have a page yet. Edit it so it saves, then try again."
            : "This idea isn't saved to your account yet. Check your connection and try again."
        );
      }
      // The draft's link starts with the idea's address. Given first, so a
      // page that took a minute to write isn't lost to a failure here.
      await pageAddress(idea);
      if (epoch !== authEpoch) return;
      const { content, finishReason } = await cloud.generate(key, model, landingLib.buildMessages(idea, CRITERIA), onProgress, controller.signal);
      // Deleted while it was written: there is nothing to keep it for.
      if (gone()) return;
      if (finishReason === 'content_filter') throw new Error(`${provider.name}'s safety filter stopped the page. Reword the notes and try again.`);
      const html = landingLib.extractHTML(content);
      if (!html) {
        throw new Error(finishReason === 'length' || !finishReason ? 'The page came back cut short. Try again.' : "The model's answer had no web page in it. Try again.");
      }
      if (landingLib.byteLength(html) > landingLib.MAX_HTML_BYTES) throw new Error('The page came back too big to keep (over 256 KB). Try again.');
      if (epoch !== authEpoch) return;
      let draft;
      try {
        draft = await cloud.saveDraft(idea.id, model, html);
      } catch (err) {
        // Drafts made on another device took the last place in the account.
        if (err.code === '23514' && /drafts/.test(err.message)) throw new Error(DRAFTS_FULL);
        throw err;
      }
      if (epoch !== authEpoch || gone()) return;
      landing.drafts.set(idea.id, [draft, ...draftsOf(idea.id).filter((d) => d.id !== draft.id)]);
      landing.html.set(draft.id, html);
      landing.changes++;
      message = { text: 'Draft saved and published at its own link. Open it to see the page, make another to compare, or make it production.', kind: 'ok' };
    } catch (err) {
      if (epoch !== authEpoch || gone() || (await leftForRemovedAccess(err, epoch))) return;
      message = { text: generateErrorText(err, provider.name), kind: 'error' };
    } finally {
      if (epoch === authEpoch) {
        landing.busy.delete(idea.id);
        landing.stops.delete(idea.id);
        if (message) landing.messages.set(idea.id, message);
        renderLanding();
      }
    }
  }

  // A draft's HTML, loaded once.
  async function draftPage(draftId) {
    if (!landing.html.has(draftId)) landing.html.set(draftId, await cloud.loadDraftHTML(draftId));
    return landing.html.get(draftId);
  }

  // A change to a page or draft that the database refused, or that matched
  // nothing (as happens once an invite is removed): if access was removed,
  // the tab signs out, saying so, and true is returned.
  async function leftForRemovedAccess(err, epoch) {
    if (!(cloud.isAccessDenied(err) || err?.code === 'PGRST116') || !(await cloud.accessRemoved())) return false;
    if (epoch === authEpoch && signedIn) await leaveRemovedAccess('Your access to this app was removed.');
    return true;
  }

  // Runs one change to a draft: its buttons wait meanwhile, and the outcome is
  // said in the panel. `change` returns the message for success.
  async function changeDraft(draftId, change, failed) {
    const idea = selected();
    const draft = draftsOf(idea?.id).find((d) => d.id === draftId);
    if (!draft || landing.working.has(draftId)) return;
    const epoch = authEpoch;
    landing.asking = null;
    landing.working.add(draftId);
    renderLanding();
    try {
      const text = await change(idea, draft, epoch);
      if (epoch !== authEpoch) return;
      landing.changes++;
      landing.messages.set(idea.id, { text, kind: 'ok' });
    } catch (err) {
      if (epoch !== authEpoch || (await leftForRemovedAccess(err, epoch))) return;
      landing.messages.set(idea.id, { text: `${failed} (${err.message}). Try again.`, kind: 'error' });
    } finally {
      if (epoch === authEpoch) {
        landing.working.delete(draftId);
        if (selected()?.id === idea.id) renderLanding();
      }
    }
  }

  const replaceDraft = (ideaId, draft) => landing.drafts.set(ideaId, draftsOf(ideaId).map((d) => (d.id === draft.id ? draft : d)));

  // Publishes or unpublishes a draft's own link. A draft made before drafts
  // had links may need the idea's address first.
  function toggleDraftLink(draftId) {
    const draft = draftsOf(selected()?.id).find((d) => d.id === draftId);
    const publish = !(draft?.published && landing.pages.has(selected().id));
    return changeDraft(
      draftId,
      async (idea, { id }, epoch) => {
        if (publish) await pageAddress(idea);
        const saved = await cloud.setDraftPublished(id, publish);
        if (epoch === authEpoch) replaceDraft(idea.id, saved);
        return publish ? 'Draft published at its own link.' : 'Draft unpublished: its link no longer works until you publish it again.';
      },
      publish ? 'The draft could not be published' : 'The draft could not be unpublished'
    );
  }

  function deleteDraft(draftId) {
    return changeDraft(
      draftId,
      async (idea, { id }, epoch) => {
        // Nothing deleted: already gone (deleted in another tab), or access removed.
        if (!(await cloud.deleteDraft(id))) {
          if (await cloud.accessRemoved()) throw Object.assign(new Error('Access removed.'), { code: '42501' });
        }
        if (epoch !== authEpoch) return '';
        landing.drafts.set(idea.id, draftsOf(idea.id).filter((d) => d.id !== id));
        landing.html.delete(id);
        // The production page stays; it just no longer comes from a draft that is kept.
        const page = landing.pages.get(idea.id);
        if (page?.draftId === id) page.draftId = null;
        return 'Draft deleted.';
      },
      'The draft could not be deleted'
    );
  }

  // One change to an idea's production page at a time: an unpublish confirmed
  // while a draft is still being made production would otherwise be undone by
  // it, and the other way round. `change` returns the message for success.
  async function changeProduction(draftId, change, failed) {
    const idea = selected();
    if (!idea || landing.changing.has(idea.id) || (draftId && landing.working.has(draftId))) return;
    const epoch = authEpoch;
    landing.changing.add(idea.id);
    if (draftId) landing.working.add(draftId);
    landing.asking = null;
    renderLanding();
    try {
      const { page, text } = await change(idea);
      if (epoch !== authEpoch) return;
      landing.pages.set(idea.id, page);
      landing.changes++;
      landing.messages.set(idea.id, { text, kind: 'ok' });
    } catch (err) {
      if (epoch !== authEpoch || (await leftForRemovedAccess(err, epoch))) return;
      // Pages made on another device took the last place in the account.
      const text = err.code === '23514' && /production pages/.test(err.message) ? PAGES_FULL : `${failed} (${err.message}). Try again.`;
      landing.messages.set(idea.id, { text, kind: 'error' });
    } finally {
      if (epoch === authEpoch) {
        landing.changing.delete(idea.id);
        if (draftId) landing.working.delete(draftId);
        if (selected()?.id === idea.id) renderLanding();
      }
    }
  }

  // Copies a draft to the idea's own address and publishes it there,
  // replacing the production page before; the address stays.
  function makeProduction(draftId) {
    const idea = selected();
    const draft = draftsOf(idea?.id).find((d) => d.id === draftId);
    if (!draft) return;
    if (pageLimitText(idea.id)) return setLandingMessage(idea.id, pageLimitText(idea.id), 'error');
    return changeProduction(
      draftId,
      async (idea) => {
        const html = await draftPage(draftId);
        const { slug } = await pageAddress(idea);
        const page = await cloud.savePage(idea.id, slug, html, draftId);
        return { page, text: `The ${modelLabel(draft.model)} draft is now production, live at the idea's own address.` };
      },
      'The draft could not be made production'
    );
  }

  // The draft the production page was copied from shows the same page at its
  // own link, so it is unpublished too: taking the page down takes it down.
  // Whatever this tab last saw of it: another device may have published it
  // since. If that fails, the page is still down, and the message says so.
  function unpublishProduction() {
    return changeProduction(
      null,
      async (idea) => {
        const epoch = authEpoch;
        const page = await cloud.setPagePublished(idea.id, false);
        let draft = '';
        if (page.draftId) {
          try {
            const saved = await cloud.setDraftPublished(page.draftId, false);
            if (epoch === authEpoch) replaceDraft(idea.id, saved);
            draft = ', with the draft it came from';
          } catch (err) {
            if (cloud.isAccessDenied(err)) throw err;
            draft = `, but the draft it came from could not be unpublished (${err.message}): unpublish its link below`;
          }
        }
        return {
          page,
          text: `Unpublished${draft}. The production address stays this idea's: Publish again brings the page back as it was. Your drafts are still here.`,
        };
      },
      'The page could not be unpublished'
    );
  }

  function republishProduction() {
    return changeProduction(
      null,
      async (idea) => ({ page: await cloud.setPagePublished(idea.id, true), text: 'Published again, as it was, at the same address.' }),
      'The page could not be published'
    );
  }

  // Copies a link, or selects it to copy by hand where the browser won't.
  async function copyLink(url, shown) {
    const ideaId = selected().id;
    try {
      await navigator.clipboard.writeText(url);
      setLandingMessage(ideaId, 'Link copied.');
    } catch {
      if (shown) getSelection().selectAllChildren(shown);
      setLandingMessage(ideaId, 'Link selected. Press Ctrl+C or ⌘C to copy.');
    }
  }

  function copyLandingLink() {
    const page = landing.pages?.get(selected()?.id);
    if (page) return copyLink(pageURL(page.slug), $('#landing-link'));
  }

  function copyDraftLink(draftId) {
    const page = landing.pages?.get(selected()?.id);
    const draft = draftsOf(selected()?.id).find((d) => d.id === draftId);
    if (page && draft) return copyLink(pageURL(page.slug, draft.code), $(`[data-draft-row="${CSS.escape(draftId)}"] .landing-draft-link`));
  }

  // ---------- Settings: the models, the API Vault, backups, the theme ----------

  // One view holds every choice kept in this browser. A feature that needs
  // a key or a model opens it at that field, with a Back button to where
  // the person was.
  const settingsView = els.settingsView;
  const settings = { from: null }; // the view a feature opened Settings from, or null
  const modelSettings = []; // each model choice's fill(), run when the view shows

  // A feature's model choice, for landing pages (#ai-model), for Coach
  // (#coach-model) and for competition reviews (#landscape-model): a select
  // of `models` (landing.MODELS, or reviews' pairs), each a model id with
  // its provider and label, grouped by vendor. The choice is kept in
  // `store` as soon as it changes, and `onSaved` redraws what names it.
  function modelSetting(prefix, store, onSaved, models = landingLib.MODELS) {
    const modelSelect = $(`#${prefix}-model`);
    const status = $(`#${prefix}-model-status`);
    const infoOf = (id) => models.find((m) => m.id === id) || models[0];
    modelSelect.innerHTML = Object.entries(landingLib.PROVIDERS)
      .map(([id, p]) => {
        const options = models.filter((m) => m.provider === id).map((m) => `<option value="${escapeHTML(m.id)}">${escapeHTML(m.label)}</option>`);
        return options.length ? `<optgroup label="${escapeHTML(p.name)}">${options.join('')}</optgroup>` : '';
      })
      .join('');

    // Shows the chosen model's note, if it has one.
    function showModel() {
      const info = infoOf(modelSelect.value);
      const note = $(`#${prefix}-model-note`);
      note.textContent = info.note || '';
      note.hidden = !info.note;
    }

    function fill() {
      modelSelect.value = infoOf(store.read().model).id;
      showModel();
      status.textContent = '';
    }

    modelSelect.addEventListener('change', () => {
      showModel();
      try {
        store.write(modelSelect.value);
      } catch {
        status.textContent = "This browser didn't let the choice be kept (a private window?).";
        return;
      }
      status.textContent = '';
      onSaved();
    });
    modelSettings.push(fill);
  }

  // The API Vault: one row per vendor (PROVIDERS), with its key, whether one
  // is kept, where to get one, and a Forget button of its own. Save keeps
  // every row: a key typed is kept, a row emptied is forgotten.
  const vaultStatus = $('#vault-status');
  $('#vault-rows').innerHTML = Object.entries(landingLib.PROVIDERS)
    .map(
      ([id, p]) =>
        `<div class="vault-row">` +
        `<label class="vault-key"><span class="field-label">${escapeHTML(p.name)}</span>` +
        `<input type="password" id="vault-key-${escapeHTML(id)}" data-vendor="${escapeHTML(id)}" placeholder="${escapeHTML(p.keyStart)}…" autocomplete="off" spellcheck="false"></label>` +
        `<span class="vault-state" data-vault-state="${escapeHTML(id)}"></span>` +
        `<button type="button" class="btn btn-small" id="vault-forget-${escapeHTML(id)}" data-forget="${escapeHTML(id)}">Forget</button>` +
        `<a class="vault-link" href="${escapeHTML(p.getKey)}" target="_blank" rel="noopener">Get ${/^[aeiou]/i.test(p.keyName) ? 'an' : 'a'} ${escapeHTML(p.keyName)}</a>` +
        `</div>`
    )
    .join('');
  const vaultInputs = [...settingsView.querySelectorAll('input[data-vendor]')];
  const vaultInput = (vendor) => vaultInputs.find((i) => i.dataset.vendor === vendor);

  // The keys as the view last showed them, so Save knows which fields were
  // changed here.
  let vaultShown = {};

  function showVaultStates() {
    for (const el of settingsView.querySelectorAll('[data-vault-state]')) {
      const kept = Boolean(vaultShown[el.dataset.vaultState]);
      el.textContent = kept ? 'Key saved' : 'No key';
      el.classList.toggle('is-set', kept);
      $(`#vault-forget-${el.dataset.vaultState}`).disabled = !kept;
    }
  }

  function fillVault() {
    vaultShown = vault.read();
    for (const input of vaultInputs) input.value = vaultShown[input.dataset.vendor] || '';
    showVaultStates();
  }

  // Draws the view as the choices are kept now. The AI sections are there
  // with accounts on only, like the features they serve.
  function renderSettings() {
    for (const el of settingsView.querySelectorAll('[data-cloud]')) el.hidden = !cloud.enabled;
    $('#view-settings .page-sub').textContent = cloud.enabled ? 'Your AI keys and models, what your account holds, and backups. Keys and models stay in this browser.' : 'Backups of your ideas. They stay in this browser.';
    renderUsage();
    fillVault();
    vaultStatus.textContent = '';
    for (const fill of modelSettings) fill();
    const back = $('#settings-back');
    back.hidden = !settings.from;
    $('#settings-back-label').textContent = { ideas: state.selectedId ? 'Back to the idea' : 'Back to Ideas', matrix: 'Back to Compare', coach: 'Back to Coach' }[settings.from] || 'Back';
  }

  // What the account holds out of the most it keeps, in Settings → Usage:
  // ideas, drafts, production pages and reviews. Drawn whenever one of them
  // changes, so the numbers are right if the view is open; '…' until the
  // pages or reviews have loaded.
  function renderUsage() {
    if (!cloud.enabled) return;
    const rows = [
      ['ideas', state.ideas.length, core.MAX_IDEAS],
      ['drafts', landing.pages ? accountDrafts() : null, landingLib.ACCOUNT_DRAFT_LIMIT],
      ['pages', landing.pages ? accountPages() : null, landingLib.ACCOUNT_PAGE_LIMIT],
      ['reviews', landscape.reviews ? accountReviews() : null, landscapeLib.ACCOUNT_REVIEW_LIMIT],
    ];
    for (const [what, n, limit] of rows) {
      const el = $(`#usage-${what}`);
      if (!el) continue;
      el.textContent = `${n == null ? '…' : n}/${limit}`;
      el.classList.toggle('is-full', n != null && n >= limit);
    }
  }

  // Opens Settings from a feature, at `focus` (a field's selector) or at
  // `section` (its id), with `status` on the keys' status line, and a way
  // back to the view it came from.
  function openSettings({ status = '', focus, section } = {}) {
    if (state.view !== 'settings') settings.from = state.view;
    setView('settings');
    vaultStatus.textContent = status;
    const target = focus ? $(focus) : section ? $(`#${section}`) : null;
    if (!target) return;
    if (focus) target.focus();
    target.scrollIntoView({ block: focus ? 'center' : 'start' });
  }

  // Opens the Vault, with `text` as its status and the cursor in `vendor`'s
  // key field (the first one otherwise).
  function openVault(text = '', vendor) {
    openSettings({ status: text, focus: `#${(vaultInput(vendor) || vaultInputs[0]).id}` });
  }

  // Keeps the fields changed here, over the keys as they are kept now: a key
  // forgotten or added in another tab meanwhile stays so.
  function saveVault() {
    const keys = vault.read();
    for (const input of vaultInputs) {
      const vendor = landingLib.PROVIDERS[input.dataset.vendor];
      const key = input.value.trim();
      if (key === (vaultShown[input.dataset.vendor] || '')) continue;
      if (key && !vendor.keyPattern.test(key) && input.dataset.warned !== key) {
        // Said once; saving again keeps it anyway, in case the vendor changes the format.
        input.dataset.warned = key;
        vaultStatus.textContent = `${vendor.keyName}s start with ${vendor.keyStart}. Check you copied the whole key, or click Save again to keep this one.`;
        input.focus();
        return;
      }
      if (key) keys[input.dataset.vendor] = key;
      else delete keys[input.dataset.vendor];
    }
    try {
      vault.write(keys);
    } catch {
      vaultStatus.textContent = "This browser didn't let the keys be kept (a private window?).";
      return;
    }
    fillVault();
    vaultStatus.textContent = 'Keys saved in this browser.';
  }

  // Emptied on the sign-in screen, so nothing of the last account shows.
  function clearVault() {
    vaultShown = {};
    for (const input of vaultInputs) input.value = '';
    showVaultStates();
    vaultStatus.textContent = '';
  }

  $('#vault-save').addEventListener('click', saveVault);
  settingsView.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[data-vendor]')) {
      e.preventDefault();
      saveVault();
    }
  });
  settingsView.addEventListener('click', (e) => {
    const vendor = e.target.closest('[data-forget]')?.dataset.forget;
    if (vendor) {
      vault.forget(vendor);
      vaultInput(vendor).value = '';
      delete vaultShown[vendor];
      showVaultStates();
      vaultStatus.textContent = `${landingLib.PROVIDERS[vendor].name}'s key forgotten in this browser.`;
    }
  });
  $('#settings-back').addEventListener('click', () => {
    const to = settings.from || 'ideas';
    settings.from = null;
    setView(to);
  });

  // The Generate button names the chosen model.
  modelSetting('ai', landingKeys, () => renderLanding());

  // ---------- Coach ----------

  // A chatbot that scores the person's ideas and works them toward Buildable
  // with the model and key they choose for it
  // (src/coach.js has what it is told and its tools). Its tools run here, on
  // the ideas in this tab; it can only propose ideas, and the person saves
  // them. Conversations are kept in this browser only, per account, like the
  // keys. Only with accounts on: the Worker checks the sign-in.
  const coachLib = window.IdeaCoach;
  const coachKeys = modelStore('ideation-calculator/coach-api/');
  const COACH_STORE = 'ideation-calculator/coach/';
  const COACH_KEEP = 20; // conversations kept, newest first
  const COACH_BUDGET = 1000000; // characters of browser storage they may use
  const COACH_ROUNDS = 8; // tool rounds in one answer before Coach has to stop and say so
  const COACH_BUSY = 'Coach is still answering. Wait for it, or click Stop, then try again.';
  const coach = {
    conversations: [], // [{ id, title, model, messages, notes, outcomes, updatedAt }], newest first
    deleted: new Set(), // ids of conversations deleted, in any tab
    currentId: null,
    busy: null, // { id, controller, text, thinking } while an answer streams in
    error: '',
    asking: null, // { id: proposal call id } or { deleteConversation: true } waiting for a yes
    picking: false, // choosing which idea to grill
    notKept: null, // id of the open conversation when it couldn't be kept in this browser (storage full)
  };
  let coachPrompt = null;
  const coachSystem = () => (coachPrompt ??= coachLib.buildSystemPrompt(DESCRIPTIONS));
  const coachView = $('#view-coach');
  const coachLog = $('#coach-log');
  const coachInput = $('#coach-input');
  const currentConversation = () => coach.conversations.find((c) => c.id === coach.currentId) || null;

  function loadCoach() {
    coach.conversations = [];
    coach.deleted = new Set();
    mergeCoach();
    coach.currentId = coach.conversations[0]?.id ?? null;
    renderCoach();
  }

  // What this browser keeps for the account: the conversations, and the ids
  // of those deleted, so a tab that still has one can't bring it back.
  // (Kept as a plain list of conversations before there were deletions.)
  function readCoach() {
    try {
      const saved = JSON.parse(localStorage.getItem(COACH_STORE + account.id) || 'null');
      const list = Array.isArray(saved) ? saved : Array.isArray(saved?.conversations) ? saved.conversations : [];
      const deleted = Array.isArray(saved?.deleted) ? saved.deleted.filter((id) => typeof id === 'string') : [];
      return { conversations: list.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages)), deleted };
    } catch {
      // Nothing kept, or not readable: none.
      return { conversations: [], deleted: [] };
    }
  }

  // Puts what other tabs of this account saved together with this tab's
  // conversations: for each, the version changed last (or the one answering
  // here), without those deleted anywhere. Returns what to keep.
  function mergeCoach() {
    const saved = readCoach();
    for (const id of saved.deleted) coach.deleted.add(id);
    const mine = new Map(coach.conversations.map((c) => [c.id, c]));
    const all = new Map();
    for (const c of saved.conversations) {
      if (coach.deleted.has(c.id)) continue;
      c.notes ??= [];
      c.outcomes ??= {};
      all.set(c.id, c);
    }
    // What was done with a card is never undone: whichever copy is kept takes
    // the other's outcomes too, with each one's note while it still waits to
    // be sent to Coach.
    const takeOutcomes = (into, from) => {
      for (const [callId, outcome] of Object.entries(from.outcomes)) {
        if (into.outcomes[callId]) continue;
        into.outcomes[callId] = outcome;
        if (outcome.note && from.notes.includes(outcome.note) && !into.notes.includes(outcome.note)) into.notes.push(outcome.note);
      }
    };
    for (const c of mine.values()) {
      const theirs = all.get(c.id);
      if (coach.deleted.has(c.id) || (!c.messages.length && c.id !== coach.currentId)) continue;
      if (!theirs || theirs.updatedAt <= c.updatedAt || coach.busy?.id === c.id) {
        if (theirs) takeOutcomes(c, theirs);
        all.set(c.id, c);
      } else takeOutcomes(theirs, c);
    }
    coach.conversations = [...all.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    // A conversation nothing was said in yet isn't kept.
    return { keep: coach.conversations.filter((c) => c.messages.length).slice(0, COACH_KEEP), deleted: [...coach.deleted].slice(-200) };
  }

  // Keeps the conversations in this browser, with what other tabs saved.
  // They use at most COACH_BUDGET characters, so there is always room left
  // to keep unsaved ideas (keepUnsaved). Past it, or when the browser's
  // storage is full, the oldest go first; the one open now is always kept.
  // If even that one alone doesn't fit, Coach says so (`coach.notKept`).
  function saveCoach() {
    if (!account) return;
    let { keep, deleted } = mergeCoach();
    const notKept = coach.notKept;
    for (;;) {
      try {
        const text = JSON.stringify({ conversations: keep, deleted });
        if (text.length > COACH_BUDGET && keep.some((c) => c.id !== coach.currentId)) throw new Error('Over the budget');
        localStorage.setItem(COACH_STORE + account.id, text);
        coach.conversations = coach.conversations.filter((c) => keep.includes(c) || (!c.messages.length && c.id === coach.currentId));
        coach.notKept = null;
        break;
      } catch {
        const oldest = keep.findLastIndex((c) => c.id !== coach.currentId);
        if (oldest === -1) {
          coach.notKept = coach.currentId;
          break;
        }
        keep = keep.filter((_, i) => i !== oldest);
      }
    }
    if (coach.notKept !== notKept && state.view === 'coach') renderCoach();
  }

  // Another tab of this account saved: show what it changed here.
  window.addEventListener('storage', (e) => {
    if (!account || !signedIn || e.key !== COACH_STORE + account.id) return;
    mergeCoach();
    // An answer for a conversation deleted there stops.
    if (coach.busy && !coach.conversations.some((c) => c.id === coach.busy.id)) coach.busy.controller.abort();
    // Only a conversation deleted there is left; one not open here stays not open.
    if (coach.currentId && !coach.conversations.some((c) => c.id === coach.currentId)) coach.currentId = coach.conversations[0]?.id ?? null;
    if (state.view === 'coach') renderCoach();
    else renderCoachList();
  });

  function forgetCoach() {
    coach.busy?.controller.abort();
    Object.assign(coach, { conversations: [], deleted: new Set(), currentId: null, busy: null, error: '', asking: null, picking: false, notKept: null });
    // Nothing of this account stays on screen, a message typed but not sent included.
    if (coachLog) coachLog.innerHTML = '';
    if (coachInput) coachInput.value = '';
  }

  function newConversation() {
    // One empty conversation at a time.
    coach.conversations = coach.conversations.filter((c) => c.messages.length || coach.busy?.id === c.id);
    const conversation = { id: core.createIdea().id, title: 'New conversation', model: coachKeys.read().model, messages: [], notes: [], outcomes: {}, updatedAt: new Date().toISOString() };
    coach.conversations.unshift(conversation);
    coach.currentId = conversation.id;
    coach.error = '';
    coach.asking = null;
    coach.picking = false;
    return conversation;
  }

  const coachModelLabel = () => modelLabel(coachKeys.read().model);

  // A tool call's arguments as an object: anything else the model sent (no
  // JSON, or JSON that isn't an object, such as null) counts as none.
  function callArgs(call) {
    try {
      const args = JSON.parse(call.function.arguments || '{}');
      return args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    } catch {
      return {};
    }
  }

  // What each tool call looks like in the chat, when it isn't a card.
  function toolLine(call, conversation) {
    const args = callArgs(call);
    const name = (id) => state.ideas.find((i) => i.id === id)?.name;
    const text = {
      list_ideas: 'Read your ideas',
      get_idea: `Read ${name(args.id) ? `“${name(args.id)}”` : 'an idea'}`,
      score_idea: args.set || args.gates || args.goal ? 'Worked out what a change would score' : 'Scored the idea',
    }[call.function.name];
    if (call.function.name === 'propose_idea') return proposalHTML(call, args, conversation);
    return text ? `<p class="coach-tool">${escapeHTML(text)}</p>` : '';
  }

  // A proposed idea (Coach's propose_idea, or a competition review's
  // proposal), checked again against the ideas as they are now: its heading,
  // and the score before and after with everything saving it would write.
  // `problems` say why it can't be used.
  function proposalParts(args) {
    // Arguments shaped in a way nothing expects (a `toString` key, say) must
    // not stop the conversation or review from being drawn: the card says it
    // can't be used instead.
    try {
      return checkedProposalParts(args);
    } catch {
      const problems = ["it couldn't be read"];
      return { head: 'A proposal', problems, html: `<div class="coach-card"><h4>A proposal</h4><p class="coach-card-note">This proposal can't be used now: ${problems[0]}.</p></div>` };
    }
  }

  function checkedProposalParts(args) {
    const { before, after, problems } = coachLib.checkProposal(args, state.ideas);
    const asText = (v) => (typeof v === 'string' ? v : '');
    const head = args?.mode === 'update' && before ? `Changes to “${escapeHTML(before.name)}”` : `New idea: ${escapeHTML(after?.name || asText(args?.name))}`;
    if (problems?.length) return { head, problems, html: `<div class="coach-card"><h4>${head}</h4><p class="coach-card-note">This proposal can't be used now: ${escapeHTML(problems.join('; '))}.</p></div>` };
    const scoreText = (idea) => {
      const v = core.verdict(idea);
      const avg = core.scoreIdea(idea).average;
      const verdict = v.status === 'scored' ? `${v.label}, ${v.score} of ${v.max} points` : v.status === 'failed' ? (v.failedGates.length ? 'Gate failed' : 'Failed by hand') : v.status === 'no-goal' ? 'No goal yet' : 'No verdict yet';
      return `${verdict} · Average Stars ${avg == null ? '–' : avg.toFixed(2)}`;
    };
    const list = coachLib.changes(before, after);
    // Everything it would write is listed, long text folded but there to read.
    const value = (c) =>
      c.text
        ? [...c.to].length > 160
          ? `<details><summary>${escapeHTML([...c.to].slice(0, 80).join(''))}…</summary><p class="coach-change-text">${escapeHTML(c.to)}</p></details>`
          : `<span class="coach-change-text">${escapeHTML(c.to)}</span>`
        : `${escapeHTML(c.from)} → ${escapeHTML(c.to)}${c.stars ? ' stars' : ''}`;
    const items = list.length ? `<ul class="coach-changes">${list.map((c) => `<li><span>${escapeHTML(c.what)}</span> ${value(c)}</li>`).join('')}</ul>` : '';
    const rows = before
      ? items || '<p class="coach-card-note">Nothing to change: the saved idea already matches.</p>'
      : `<p class="coach-card-note">${escapeHTML(after.goal ? core.GOALS[after.goal].label : 'No goal')} · ${core.GATE_IDS.filter((g) => after.gates[g] === 'pass').length} of 4 gates passed · ${Object.keys(after.ratings).length} of 21 lines rated</p>${items}`;
    // Before and after, side by side, with the same words for screen readers.
    const side = (idea, label, cls) => {
      const v = core.verdict(idea);
      const avg = core.scoreIdea(idea).average;
      return `<div class="coach-side ${cls}" aria-hidden="true"><span class="readout-label">${label}</span>${
        v.status === 'scored' ? `<span class="coach-side-points">${v.score} / ${v.max}</span>` : ''
      }${rowVerdictHTML(idea)}<span class="coach-side-avg">Average Stars ${avg == null ? '–' : avg.toFixed(2)}</span></div>`;
    };
    const score =
      (before
        ? `<div class="coach-diff">${side(before, 'Before', 'is-before')}<span class="coach-diff-arrow" aria-hidden="true">→</span>${side(after, 'After', 'is-after')}</div>`
        : `<div class="coach-diff">${side(after, 'This idea', 'is-after')}</div>`) +
      `<p class="coach-score visually-hidden">${before ? `${escapeHTML(scoreText(before))} → ` : ''}<strong>${escapeHTML(scoreText(after))}</strong></p>`;
    return { head, before, after, list, problems: [], body: `${asText(args.change) ? `<p class="coach-card-note">${escapeHTML(args.change)}</p>` : ''}${score}${rows}` };
  }

  // Coach's card for one propose_idea call, with the buttons that save it.
  function proposalHTML(call, args, conversation) {
    const id = escapeHTML(call.id);
    const outcome = conversation.outcomes[call.id];
    const parts = proposalParts(args);
    if (parts.problems.length) return parts.html;
    const { head, before, list } = parts;
    let actions;
    if (outcome) {
      const saved = state.ideas.find((i) => i.id === outcome.ideaId);
      actions = `<p class="coach-card-note is-done">${outcome.kind === 'saved' ? 'Saved as a new idea.' : outcome.kind === 'applied' ? 'Applied to the idea.' : 'Not saved.'}${saved && outcome.kind !== 'dismissed' ? ` <button type="button" class="btn btn-small btn-ghost" data-action="coach-open-idea" data-idea="${escapeHTML(saved.id)}">Open it</button>` : ''}</p>`;
    } else if (coach.asking?.id === call.id) {
      actions = `<p>Apply these changes to “${escapeHTML(before.name)}”? Its stars, gates and notes change as listed.</p><button type="button" class="btn btn-small" data-action="coach-keep" data-call="${id}">Keep it as it is</button><button type="button" class="btn btn-small btn-primary" data-action="coach-apply" data-call="${id}">Apply</button>`;
    } else {
      actions =
        (before
          ? `<button type="button" class="btn btn-small btn-primary" data-action="coach-ask-apply" data-call="${id}"${list.length ? '' : ' disabled'}>Apply to this idea</button>`
          : `<button type="button" class="btn btn-small btn-primary" data-action="coach-save" data-call="${id}">Save as new idea</button>`) +
        `<button type="button" class="btn btn-small btn-ghost" data-action="coach-dismiss" data-call="${id}">Not now</button>`;
    }
    return `<div class="coach-card" data-card="${id}"><h4>${head}</h4>${parts.body}<div class="landing-actions confirm">${actions}</div></div>`;
  }

  // Coach writes each question as a ❓ line and its recommended answer as a ➡️
  // line (buildSystemPrompt in src/coach.js). Those become cards, each with a
  // Yes and a No that type the answer ("2 yes") into the box, ready to send
  // or add to. Anything else in the answer stays as it is.
  function questionCards(html) {
    const card = (ask, rec) => {
      const n = (ask.match(/\bQ(\d+)\b/) || [])[1];
      const replies = n
        ? `<div class="coach-q-replies"><button type="button" class="btn btn-small" data-action="coach-reply" data-text="${n} yes">Yes</button><button type="button" class="btn btn-small" data-action="coach-reply" data-text="${n} no">No</button></div>`
        : '';
      return `<div class="coach-q"><p class="coach-q-ask">${ask}</p>${rec ? `<p class="coach-q-rec">${rec}</p>` : ''}${replies}</div>`;
    };
    return html
      .replace(/<p>❓\s*([\s\S]*?)(?:<br>|<\/p><p>)➡️?\s*([\s\S]*?)<\/p>/g, (m, ask, rec) => card(ask, rec))
      .replace(/<p>❓\s*([\s\S]*?)<\/p>/g, (m, ask) => card(ask, ''));
  }
  const coachTextHTML = (content) => `<div class="coach-text">${questionCards(coachLib.renderMarkdown(content))}</div>`;

  function messageHTML(m, conversation) {
    // A starter's message shows as the person would put it; what Coach is sent can say more (an idea's id).
    if (m.role === 'user') return `<div class="coach-msg is-user"><p>${escapeHTML(m.display ?? m.content).replace(/\n/g, '<br>')}</p></div>`;
    if (m.role !== 'assistant') return '';
    const tools = (m.tool_calls || []).map((c) => toolLine(c, conversation)).join('');
    const text = m.content ? coachTextHTML(m.content) : '';
    return text || tools ? `<div class="coach-msg is-coach">${text}${tools}</div>` : '';
  }

  function startHTML() {
    const ideas = core.sortIdeas(state.ideas, state.sort);
    const picker = coach.picking
      ? `<div class="coach-pick"><label class="field"><span class="field-label">Which idea?</span><select id="coach-idea">${ideas.map((i) => `<option value="${escapeHTML(i.id)}">${escapeHTML(i.name)}</option>`).join('')}</select></label><button type="button" class="btn btn-primary" data-action="coach-grill-picked">Grill it</button></div>`
      : '';
    return (
      '<div class="coach-start"><h3>What shall we work on?</h3>' +
      "<p>Coach scores ideas the way this app does, then asks you questions round by round, each with a recommended answer and what it's worth in points, until the idea is Buildable. It can save what you agree on as an idea, once you say so.</p>" +
      '<div class="coach-starters">' +
      '<button type="button" class="coach-starter" data-action="coach-start-new"><strong>Start a new idea</strong><span>Describe it in a few sentences, and Coach takes it from there.</span></button>' +
      `<button type="button" class="coach-starter" data-action="coach-start-grill"${ideas.length ? '' : ' disabled'}><strong>Pressure-test an idea</strong><span>Score one of your ideas and improve it.</span></button>` +
      `<button type="button" class="coach-starter" data-action="coach-start-compare"${ideas.length ? '' : ' disabled'}><strong>Compare my ideas and suggest new ones</strong><span>Which to pursue, and new ideas built on your strengths.</span></button>` +
      `</div>${picker}</div>`
    );
  }

  function renderCoachList() {
    $('#coach-list').innerHTML = coach.conversations.length
      ? coach.conversations
          .map(
            (c) =>
              `<li><button type="button" class="coach-conv" data-action="coach-open" data-conversation="${escapeHTML(c.id)}"${c.id === coach.currentId ? ' aria-current="true"' : ''}><span>${escapeHTML(c.title)}</span><span class="coach-conv-date">${escapeHTML(new Date(c.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }))}</span></button></li>`
          )
          .join('')
      : '<li class="coach-empty">No conversations yet.</li>';
  }

  function renderCoach() {
    if (!coachView || !cloud.enabled) return;
    const conversation = currentConversation();
    renderCoachList();
    const busy = coach.busy && coach.busy.id === conversation?.id ? coach.busy : null;
    const title = conversation && conversation.messages.length ? conversation.title : 'New conversation';
    $('#coach-title').textContent = title;
    $('#coach-model-name').textContent = coachModelLabel();
    const asking = coach.asking?.deleteConversation;
    $('#coach-head-actions').innerHTML = asking
      ? '<p>Delete this conversation? It is only in this browser, so it is gone for good.</p><button type="button" class="btn btn-small" data-action="coach-keep">Keep it</button><button type="button" class="btn btn-small btn-danger-solid" data-action="coach-delete">Delete</button>'
      : `<button type="button" class="btn btn-small btn-ghost" data-action="coach-key">Coach model</button>${conversation?.messages.length ? '<button type="button" class="btn btn-small btn-ghost btn-danger" data-action="coach-ask-delete">Delete conversation</button>' : ''}`;
    const messages = conversation ? conversation.messages.map((m) => messageHTML(m, conversation)).join('') : '';
    const live = busy
      ? `<div class="coach-msg is-coach is-busy">${busy.text ? coachTextHTML(busy.text) : ''}<p class="coach-tool" id="coach-progress">${busy.text ? 'Writing…' : busy.thinking ? 'Thinking…' : 'Starting…'}</p></div>`
      : '';
    const error = coach.error ? `<p class="coach-error" role="alert">${escapeHTML(coach.error)}</p>` : '';
    const notKept =
      conversation && coach.notKept === conversation.id
        ? '<p class="coach-error" role="alert" data-coach-not-kept>This conversation can’t be kept in this browser: its storage is full. It stays open here until you leave or reload the page, so copy what you need, or free some room.</p>'
        : '';
    keepFocus(() => {
      coachLog.innerHTML = (conversation?.messages.length ? messages : startHTML()) + live + error + notKept;
    });
    // One answer at a time: no other conversation starts while one comes in.
    $('#coach-new').disabled = !!coach.busy;
    $('#coach-send').hidden = !!busy;
    $('#coach-stop').hidden = !busy;
    coachInput.disabled = !!busy;
    coachInput.placeholder = conversation?.messages.length ? 'Answer, ask, or say "1 yes, 2 yes, 3 no: …"' : 'Describe your idea: what it is, who it is for, and why now.';
  }

  function scrollCoach() {
    coachLog.scrollTop = coachLog.scrollHeight;
  }

  // The messages as the Worker takes them (readChat in worker.mjs).
  function apiMessages(conversation) {
    return [
      { role: 'developer', content: coachSystem() },
      ...conversation.messages.map((m) => {
        if (m.role === 'assistant') {
          const out = { role: 'assistant', content: m.content || '' };
          if (m.tool_calls?.length) out.tool_calls = m.tool_calls;
          // A copy of the answer that a model the app no longer offers kept
          // with it is not sent: the text and calls stand in for it.
          return out;
        }
        return m.role === 'tool' ? { role: 'tool', tool_call_id: m.tool_call_id, content: m.content } : { role: 'user', content: m.content };
      }),
    ];
  }

  // Sends what the person wrote, with any notes about cards they acted on.
  // A starter can say what to show instead (`display`) and name the conversation.
  async function sendCoach(text, display, title) {
    if (!signedIn || coach.busy) return;
    text = text.trim();
    if (!text) return;
    const { model } = coachKeys.read();
    const key = vault.read()[landingLib.modelInfo(model).provider];
    if (!key) return openVault(`Add your ${providerOf(model).name} key to talk to Coach with ${modelLabel(model)}.`, landingLib.modelInfo(model).provider);
    const conversation = currentConversation() || newConversation();
    const content = [...conversation.notes, text].join('\n\n');
    conversation.notes = [];
    if (!conversation.messages.length) {
      const words = [...(title || display || text).replace(/\s+/g, ' ').trim()];
      conversation.title = words.length > 60 ? `${words.slice(0, 59).join('').trimEnd()}…` : words.join('');
    }
    conversation.messages.push(display ? { role: 'user', content, display } : { role: 'user', content });
    conversation.model = model;
    coachInput.value = '';
    await coachTurn(conversation, key, model);
  }

  // One answer: the model's reply, and as long as it calls tools, their
  // results sent back for it to carry on.
  async function coachTurn(conversation, key, model) {
    const epoch = authEpoch;
    const controller = new AbortController();
    const busy = { id: conversation.id, controller, text: '', thinking: false };
    coach.busy = busy;
    coach.error = '';
    // What this answer has to say shows only while its conversation is still there
    // (deleting it mid-answer stops the answer, which then has nothing to say).
    const say = (text) => {
      if (coach.conversations.includes(conversation)) coach.error = text;
    };
    conversation.updatedAt = new Date().toISOString();
    // The newest conversation goes to the top of the list.
    coach.conversations = [conversation, ...coach.conversations.filter((c) => c !== conversation)];
    saveCoach();
    renderCoach();
    scrollCoach();
    let frame = 0;
    const onProgress = (progress) => {
      if (epoch !== authEpoch || coach.busy !== busy) return;
      busy.text = progress.content;
      busy.thinking = progress.thinking;
      // Drawn at most once a frame, however fast the pieces come.
      if (!frame && coach.currentId === conversation.id) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (coach.busy === busy && coach.currentId === conversation.id) {
            const stick = coachLog.scrollHeight - coachLog.scrollTop - coachLog.clientHeight < 80;
            renderCoach();
            if (stick) scrollCoach();
          }
        });
      }
    };
    try {
      for (let round = 0; ; round++) {
        if (round === COACH_ROUNDS) throw new Error('Coach used its tools many times without answering. Say "carry on" to let it continue.');
        const answer = await cloud.chat(key, model, apiMessages(conversation), onProgress, controller.signal);
        if (epoch !== authEpoch) return;
        // Not kept, so the conversation can still be sent.
        if (answer.toolCalls.length > coachLib.MAX_TOOL_CALLS) {
          throw new Error(`Coach tried to use more than ${coachLib.MAX_TOOL_CALLS} tools at once. Ask it to look at fewer ideas at a time.`);
        }
        // An answer cut off midway may end in a tool call half written: it isn't run.
        const cutOff = answer.finishReason === null;
        // Only Coach's own tools; every call gets an id to answer it by, used
        // nowhere else in the conversation, since a card is found by its id,
        // and one the Worker takes back (coachLib.CALL_ID).
        const used = new Set(conversation.messages.flatMap((m) => (m.tool_calls || []).map((c) => c.id)));
        const calls = (cutOff ? [] : answer.toolCalls)
          .filter((c) => coachLib.TOOL_NAMES.includes(c.function.name))
          .map((c, i) => {
            let id = c.id || `call_${Date.now().toString(36)}_${i}`;
            if (used.has(id) || !coachLib.CALL_ID.test(id)) id = `call_${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 8)}`;
            used.add(id);
            return { ...c, id };
          });
        if (!answer.content && !calls.length) {
          if (answer.finishReason === 'content_filter') throw new Error(`${providerOf(model).name}'s safety filter stopped the answer. Try rewording your message.`);
          if (cutOff) throw new Error('The answer was cut off before it began. Try again.');
          throw new Error('The answer came back empty. Try again.');
        }
        const message = { role: 'assistant', content: answer.content };
        if (calls.length) message.tool_calls = calls;
        conversation.messages.push(message);
        if (!calls.length) {
          if (answer.finishReason === 'length') say('The answer was cut short. Say "go on" to get the rest.');
          if (answer.finishReason === null) say('The answer was cut off. Say "go on" to get the rest.');
          break;
        }
        for (const call of calls) {
          const { result } = coachLib.runTool(call.function.name, call.function.arguments, state.ideas);
          conversation.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        busy.text = '';
        busy.thinking = false;
        saveCoach();
        if (coach.currentId === conversation.id) renderCoach();
      }
    } catch (err) {
      if (epoch !== authEpoch) return;
      if (err.stopped) {
        // What had arrived stays, marked as stopped.
        const partial = err.partial?.content;
        if (partial) conversation.messages.push({ role: 'assistant', content: `${partial}\n\n*(Stopped.)*` });
        else say('Stopped.');
      } else say(generateErrorText(err, providerOf(model).name));
    } finally {
      if (epoch === authEpoch && coach.busy === busy) {
        coach.busy = null;
        if (coach.error === COACH_BUSY) coach.error = '';
        conversation.updatedAt = new Date().toISOString();
        saveCoach();
        renderCoach();
        if (coach.currentId === conversation.id) scrollCoach();
        if (coach.currentId === conversation.id && state.view === 'coach') coachInput.focus();
      }
    }
  }

  // Starts a conversation about one of the person's ideas.
  function grillIdea(idea) {
    if (!idea) return;
    if (coach.busy) {
      coach.currentId = coach.busy.id;
      coach.error = COACH_BUSY;
      return setView('coach');
    }
    newConversation();
    setView('coach');
    const ask = `Pressure-test my idea “${idea.name}”: score it, then work it toward Buildable in rounds.`;
    sendCoach(ask.replace('”:', `” (id ${idea.id}):`), ask, `Pressure-test: ${idea.name}`);
  }

  // The tool call a card belongs to. Two calls with one id (kept from before
  // ids were made unique) can't tell their cards apart, so neither is used.
  function proposalCall(callId) {
    const conversation = currentConversation();
    const calls = conversation?.messages.flatMap((m) => m.tool_calls || []).filter((c) => c.id === callId) || [];
    if (calls.length !== 1) return null;
    return { conversation, call: calls[0], args: callArgs(calls[0]) };
  }

  // Remembers what the person did with a card, and tells Coach with their next message.
  function settleProposal(conversation, callId, outcome, note) {
    // The note goes with the outcome, so a tab that takes the outcome from
    // another (mergeCoach) tells Coach too.
    conversation.outcomes[callId] = { ...outcome, note };
    conversation.notes.push(note);
    // Newer than what another tab holds, so its next save doesn't undo this.
    conversation.updatedAt = new Date().toISOString();
    coach.asking = null;
    saveCoach();
    renderCoach();
  }

  // Copies a checked proposal onto the saved idea it changes, and shows it.
  function applyFields(ideaId, after) {
    const idea = state.ideas.find((i) => i.id === ideaId);
    for (const field of ['name', 'goal', 'status', 'tags', 'notes', 'gates', 'ratings', 'ratingNotes', 'settings']) idea[field] = after[field];
    touch(idea);
    renderAll();
    return idea;
  }

  function saveProposal(callId) {
    const found = proposalCall(callId);
    if (!found) return;
    const { after, problems } = coachLib.checkProposal(found.args, state.ideas);
    if (problems.length) return renderCoach();
    if (state.ideas.length >= core.MAX_IDEAS) {
      coach.error = `Your account holds ${core.MAX_IDEAS} ideas, the most it can. Delete one on the Ideas tab, then save this.`;
      return renderCoach();
    }
    const idea = core.sanitizeIdea({ ...after, id: core.createIdea().id, createdAt: undefined, updatedAt: undefined });
    state.ideas.unshift(idea);
    save();
    renderFilters();
    renderList();
    settleProposal(found.conversation, callId, { kind: 'saved', ideaId: idea.id }, `(I saved “${idea.name}” as a new idea, id ${idea.id}.)`);
  }

  function applyProposal(callId) {
    const found = proposalCall(callId);
    if (!found) return;
    const { before, after, problems } = coachLib.checkProposal(found.args, state.ideas);
    if (problems.length || !before) return renderCoach();
    const idea = applyFields(before.id, after);
    settleProposal(found.conversation, callId, { kind: 'applied', ideaId: idea.id }, `(I applied the changes to “${idea.name}”.)`);
  }

  coachView?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const callId = button.dataset.call;
    switch (button.dataset.action) {
      case 'coach-new':
        if (coach.busy) return;
        newConversation();
        renderCoach();
        return coachInput.focus();
      case 'coach-open':
        if (coach.busy && coach.busy.id !== button.dataset.conversation) return;
        coach.currentId = button.dataset.conversation;
        coach.error = '';
        coach.asking = null;
        renderCoach();
        return scrollCoach();
      case 'coach-key':
        return openSettings({ focus: '#coach-model' });
      case 'coach-start-new':
        coach.picking = false;
        renderCoach();
        return coachInput.focus();
      case 'coach-start-grill':
        coach.picking = true;
        renderCoach();
        return $('#coach-idea')?.focus();
      case 'coach-grill-picked':
        return grillIdea(state.ideas.find((i) => i.id === $('#coach-idea').value));
      case 'coach-start-compare':
        if (!currentConversation()) newConversation();
        return sendCoach('Compare my saved ideas: which should I pursue, and why? Then suggest a few new ideas of your own, built on what my ideas show about me.');
      case 'coach-ask-delete':
        coach.asking = { deleteConversation: true };
        renderCoach();
        return $('[data-action="coach-keep"]')?.focus();
      case 'coach-delete': {
        if (coach.busy?.id === coach.currentId) coach.busy.controller.abort();
        coach.deleted.add(coach.currentId);
        coach.conversations = coach.conversations.filter((c) => c.id !== coach.currentId);
        coach.currentId = coach.conversations[0]?.id ?? null;
        coach.asking = null;
        // What went wrong in it goes with it.
        coach.error = '';
        saveCoach();
        renderCoach();
        return $('#coach-new').focus();
      }
      case 'coach-keep':
        coach.asking = null;
        renderCoach();
        return;
      case 'coach-save':
        return saveProposal(callId);
      case 'coach-ask-apply':
        coach.asking = { id: callId };
        renderCoach();
        return $(`[data-action="coach-keep"][data-call="${CSS.escape(callId)}"]`)?.focus();
      case 'coach-apply':
        return applyProposal(callId);
      case 'coach-reply': {
        const text = button.dataset.text;
        const typed = coachInput.value.replace(/\s+$/, '');
        coachInput.value = typed ? `${typed}${/[,:;]$/.test(typed) ? ' ' : ', '}${text}` : text;
        coachInput.focus();
        return;
      }
      case 'coach-dismiss': {
        const found = proposalCall(callId);
        if (found) settleProposal(found.conversation, callId, { kind: 'dismissed' }, `(I didn't save “${found.args.name || 'the proposal'}” for now.)`);
        return;
      }
      case 'coach-open-idea':
        setView('ideas');
        return select(button.dataset.idea);
    }
  });

  $('#coach-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    sendCoach(coachInput.value);
  });
  // Enter sends; Shift+Enter starts a new line.
  coachInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendCoach(coachInput.value);
    }
  });
  $('#coach-stop')?.addEventListener('click', () => coach.busy?.controller.abort());

  modelSetting('coach', coachKeys, () => renderCoach());

  // ---------- Competition (Landscape) ----------

  // A review of an idea's competition, researched on the web by the pair of
  // models the person chooses (landscapeLib.REVIEW_MODELS: a research and a
  // lead model, with their provider) with their own key for that provider
  // (src/landscape.js has the steps; worker.mjs runs them). Reviews are kept in
  // the account (up to landscapeLib.ACCOUNT_REVIEW_LIMIT, on any of its ideas),
  // and each ends with a proposal the person can apply to the idea. Only with
  // accounts on, like landing pages.
  const landscapeLib = window.IdeaLandscape;
  const landscapeKeys = modelStore('ideation-calculator/landscape-api/');
  const landscape = {
    reviews: null, // idea id -> [{ id, model, createdAt }], newest first, once loaded
    reports: new Map(), // review id -> the review, once loaded and checked
    open: new Map(), // idea id -> the review id shown
    loading: new Set(), // review ids being fetched
    working: new Set(), // review ids being deleted
    busy: new Map(), // idea id -> how far its review has got, while it runs
    stops: new Map(), // idea id -> the AbortController that stops it
    messages: new Map(), // idea id -> { text, kind }
    asking: null, // { ideaId, reviewId, action: 'delete' | 'apply' } waiting for a yes
    applied: new Set(), // review ids whose proposal was applied in this tab
    loadError: '',
    refreshing: false,
    changes: 0, // counts changes made here, so an older check can't undo them
  };

  const reviewsOf = (ideaId) => landscape.reviews?.get(ideaId) || [];
  const MODEL_LABELS = Object.fromEntries(landingLib.MODELS.map((m) => [m.id, m.label]));
  // What the reviews' choice offers: each pair of models a review can run
  // on, named by its models and kept under its research model's id (a real
  // model, so modelStore keeps it like the other features' choice; the
  // research models differ, so the id names the pair).
  const REVIEW_CHOICES = Object.entries(landscapeLib.REVIEW_MODELS).map(([key, m]) => ({
    id: m.research,
    key,
    provider: m.provider,
    label: [...new Set([m.research, m.lead])].map((id) => MODEL_LABELS[id] || id).join(' + '),
    note: landingLib.modelInfo(m.research)?.note,
  }));
  // The pair reviews run on: the one chosen in Settings, or Meta's.
  const reviewChoice = () => REVIEW_CHOICES.find((c) => c.id === landscapeKeys.read().model) || REVIEW_CHOICES.find((c) => c.key === landscapeLib.DEFAULT_MODELS);
  // The key for its provider, from the API Vault.
  const reviewKey = (provider) => vault.read()[provider] || '';

  // Why no review can be made for this idea now, or '': checked before the
  // provider is asked, so nobody pays for a review the database would refuse.
  // Reviews still running take a place too: each will be saved when it finishes.
  // Only ideas still here: deleting an idea deletes its reviews with it.
  const accountReviews = () => state.ideas.reduce((n, i) => n + reviewsOf(i.id).length, 0) + landscape.busy.size;
  const REVIEWS_FULL = `${landscapeLib.ACCOUNT_REVIEW_LIMIT} reviews is the most an account keeps in all. Delete some, on this idea or others, to make more.`;
  const reviewLimitText = () => (accountReviews() >= landscapeLib.ACCOUNT_REVIEW_LIMIT ? REVIEWS_FULL : '');

  function landscapeProgressText(p) {
    const models = landscapeLib.reviewModels(p.models);
    const searches = p.searches ? ` ${p.searches} web ${p.searches === 1 ? 'search' : 'searches'} so far.` : '';
    if (p.step === 'scout') return `Finding the competitors with ${MODEL_LABELS[models.research] || models.research}…${searches}`;
    if (p.step === 'research') return `Researching each competitor and the market: ${p.done} of ${p.total} done…${searches}`;
    if (p.step === 'review') return `Writing the review with ${MODEL_LABELS[models.lead] || models.lead}…${searches} This takes a minute or two.`;
    return 'Starting the review… It takes a few minutes.';
  }

  // A link to a source, only for web addresses, opened in a new tab without
  // telling the site where it came from. Its site shows on hover. The address
  // goes in full, so one saved as "https:/p/x" can't open on this site.
  function sourceLink(url, label) {
    if (!landscapeLib.isWebAddress(url)) return escapeHTML(label || '');
    return `<a href="${escapeHTML(new URL(url).href)}" title="${escapeHTML(new URL(url).host)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label || url.replace(/^https?:\/\/(www\.)?/, ''))}</a>`;
  }

  const bullets = (items) => (items.length ? `<ul>${items.map((i) => `<li>${escapeHTML(i)}</li>`).join('')}</ul>` : '');

  // The review's proposal as a card: the score before and after, worked out
  // by the app from the idea as it is now, and Apply.
  function reviewProposalHTML(idea, reviewId, report) {
    const parts = proposalParts(landscapeLib.proposalArgs(report, idea.id));
    if (parts.problems.length) return parts.html;
    const id = escapeHTML(reviewId);
    let actions;
    if (landscape.applied.has(reviewId)) actions = '<p class="coach-card-note is-done">Applied to the idea.</p>';
    else if (landscape.asking?.action === 'apply' && landscape.asking.reviewId === reviewId) {
      actions = `<p>Apply these changes to “${escapeHTML(idea.name)}”? Its stars, gates and notes change as listed.</p><button type="button" class="btn btn-small" data-action="landscape-keep" data-review="${id}">Keep it as it is</button><button type="button" class="btn btn-small btn-primary" data-action="landscape-apply" data-review="${id}">Apply</button>`;
    } else {
      actions = `<button type="button" class="btn btn-small btn-primary" data-action="landscape-ask-apply" data-review="${id}"${parts.list.length ? '' : ' disabled'}>Apply to this idea</button>`;
    }
    return `<div class="coach-card"><h4>The idea, made more competitive</h4>${parts.body}<div class="landing-actions confirm">${actions}</div></div>`;
  }

  function reportHTML(idea, reviewId, report, createdAt) {
    const kinds = { direct: 'Direct', indirect: 'Indirect', substitute: 'Substitute' };
    const competitors = report.competitors.length
      ? '<div class="coach-table"><table><thead><tr><th>Competitor</th><th>What it is</th><th>Pricing</th><th>Strong at</th><th>Weak at</th></tr></thead><tbody>' +
        report.competitors
          .map(
            (c) =>
              `<tr><td><strong>${sourceLink(c.url, c.name)}</strong><br><span class="landscape-kind">${escapeHTML(kinds[c.kind])}</span></td><td>${escapeHTML(c.what)}</td><td>${escapeHTML(c.pricing)}</td><td>${bullets(c.strengths)}</td><td>${bullets(c.weaknesses)}</td></tr>`
          )
          .join('') +
        '</tbody></table></div>'
      : '';
    const m = report.market;
    const market =
      `<p><strong>Demand:</strong> ${escapeHTML(m.demand || 'not found')} <span class="pill">${escapeHTML(m.trend)}</span></p>` +
      (m.pricing ? `<p><strong>What customers pay:</strong> ${escapeHTML(m.pricing)}</p>` : '') +
      (m.channels.length ? `<p><strong>Where the customers are:</strong> ${escapeHTML(m.channels.join('; '))}</p>` : '');
    const suggestions = report.suggestions.length
      ? `<ol class="landscape-suggestions">${report.suggestions
          .map(
            (s) =>
              `<li><strong>${escapeHTML(s.title)}</strong>${s.line ? ` <span class="landscape-line">${escapeHTML(landscapeLib.nameOf(s.line))}</span>` : ''}<br>${escapeHTML(s.why)}${
                s.sources.length ? ` <span class="landscape-cites">${s.sources.map((u, i) => sourceLink(u, `[${i + 1}]`)).join(' ')}</span>` : ''
              }</li>`
          )
          .join('')}</ol>`
      : '<p>No changes suggested.</p>';
    const section = (title, html) => (html ? `<section><h4>${title}</h4>${html}</section>` : '');
    const models = [report.models.research, report.models.lead].filter(Boolean).map((id) => MODEL_LABELS[id] || id);
    return (
      `<div class="landscape-report" data-review-report="${escapeHTML(reviewId)}">` +
      `<p class="landscape-summary">${escapeHTML(report.summary)}</p>` +
      section('Where it can win', report.position ? `<p>${escapeHTML(report.position)}</p>` : '') +
      section(`Competitors${report.category ? ` in ${escapeHTML(report.category)}` : ''}`, competitors) +
      section('The market', market) +
      section('Gaps nobody fills well', bullets(report.gaps)) +
      section('Risks', bullets(report.risks)) +
      section('How to make it more competitive', suggestions) +
      reviewProposalHTML(idea, reviewId, report) +
      section('Still unknown', bullets(report.unknowns)) +
      (report.sources.length
        ? `<details class="landscape-sources"><summary>Sources (${report.sources.length})</summary><ol>${report.sources.map((s) => `<li>${sourceLink(s.url, s.title)}</li>`).join('')}</ol></details>`
        : '') +
      `<p class="landing-date">${escapeHTML(when(createdAt))} · ${escapeHTML(models.join(' and '))} · ${report.searches} web searches. Check anything important at its source: web research can be wrong or out of date.</p>` +
      '</div>'
    );
  }

  function reviewRowHTML(idea, review) {
    const id = escapeHTML(review.id);
    const open = landscape.open.get(idea.id) === review.id;
    const asking = landscape.asking?.action === 'delete' && landscape.asking.reviewId === review.id;
    const actions = asking
      ? `<p>Delete this review? It is gone for good.</p><button type="button" class="btn btn-small" data-action="landscape-keep" data-review="${id}">Keep it</button><button type="button" class="btn btn-small btn-danger-solid" data-action="landscape-delete" data-review="${id}">Delete</button>`
      : `<button type="button" class="btn btn-small" data-action="landscape-open" data-review="${id}" aria-expanded="${open}">${open ? 'Hide' : 'Show'}</button>` +
        `<button type="button" class="btn btn-small btn-ghost btn-danger" data-action="landscape-ask-delete" data-review="${id}"${landscape.working.has(review.id) ? ' disabled' : ''}>Delete</button>`;
    return `<li class="landing-draft is-review${open ? ' is-production' : ''}"><span class="landing-draft-name">Review</span><span class="landing-date">${escapeHTML(when(review.createdAt))}</span><span class="landing-actions confirm">${actions}</span></li>`;
  }

  // Where a running review is: finding competitors, researching them, writing.
  const REVIEW_STEPS = [
    ['scout', 'Find the competitors'],
    ['research', 'Research them and the market'],
    ['review', 'Write the review'],
  ];
  const stepperHTML = (step) =>
    `<ol class="stepper" id="landscape-stepper" data-step="${escapeHTML(step || 'starting')}" aria-hidden="true">${REVIEW_STEPS.map(([, label], i) => `<li class="step"><i>${i + 1}</i>${label}</li>`).join('')}</ol>`;

  function landscapeHTML(idea) {
    const head =
      '<div class="landing-head"><h3 id="landscape-title">Competition</h3>' +
      '<p>Who this idea competes with, researched on the web, and how to change the idea so it can win. A review makes about 40 to 50 web searches and takes a few minutes; its proposal changes nothing until you apply it.</p></div>';
    if (!landscape.reviews) {
      return (
        head +
        (landscape.loadError
          ? `<p class="landing-message is-error">Reviews could not be loaded (${escapeHTML(landscape.loadError)}).</p><div class="landing-actions"><button type="button" class="btn btn-small" data-action="landscape-reload">Try again</button></div>`
          : '<p class="landing-message">Loading…</p>')
      );
    }
    const message = landscape.messages.get(idea.id);
    const note = `<p class="landing-message${message ? ` is-${message.kind}` : ''}" role="status">${escapeHTML(message?.text || '')}</p>`;
    const limit = reviewLimitText();
    const reviews = reviewsOf(idea.id);
    const run = landscape.busy.has(idea.id)
      ? `<div class="review-running">${stepperHTML(landscape.busy.get(idea.id).step)}<p class="landing-message is-busy" id="landscape-progress">${escapeHTML(landscapeProgressText(landscape.busy.get(idea.id)))}</p><div class="landing-actions"><button type="button" class="btn btn-small" data-action="landscape-stop">Stop</button></div></div>`
      : '<div class="landing-actions">' +
        '<button type="button" class="btn btn-small btn-ghost" data-action="landscape-key">Models</button>' +
        `<button type="button" class="btn btn-small btn-primary" data-action="landscape-run"${limit ? ' disabled' : ''}>Review the competition</button>` +
        (limit ? `<p class="landing-hint">${escapeHTML(limit)}</p>` : '') +
        '</div>';
    const toolbar = `<div class="panel-toolbar">${usageTitleHTML('Reviews', reviews.length, accountReviews(), landscapeLib.ACCOUNT_REVIEW_LIMIT)}${run}</div>`;
    const list = reviews.length ? `<ul class="landing-drafts">${reviews.map((r) => reviewRowHTML(idea, r)).join('')}</ul>` : '';
    const openId = landscape.open.get(idea.id);
    const shown = reviews.find((r) => r.id === openId);
    let report = '';
    if (shown && landscape.reports.has(shown.id)) report = reportHTML(idea, shown.id, landscape.reports.get(shown.id), shown.createdAt);
    else if (shown && landscape.loading.has(shown.id)) report = '<p class="landing-message">Loading the review…</p>';
    return head + toolbar + note + list + report;
  }

  function renderLandscape() {
    const panel = $('#landscape-panel');
    const idea = selected();
    if (panel && idea) keepFocus(() => (panel.innerHTML = landscapeHTML(idea)));
    refreshIdeaTabCounts();
    renderUsage();
  }

  function setLandscapeMessage(ideaId, text, kind = 'ok') {
    if (text) landscape.messages.set(ideaId, { text, kind });
    else landscape.messages.delete(ideaId);
    if (selected()?.id === ideaId) renderLandscape();
  }

  async function loadLandscape() {
    const epoch = authEpoch;
    landscape.reviews = null;
    landscape.loadError = '';
    renderLandscape();
    try {
      const reviews = await cloud.loadReviews();
      if (epoch !== authEpoch) return;
      landscape.reviews = reviews;
    } catch (err) {
      if (epoch !== authEpoch) return;
      landscape.loadError = err.message;
    }
    renderLandscape();
  }

  // Coming back to the tab: reviews made or deleted on another device show
  // here too, without emptying the panel while they load.
  async function refreshLandscape() {
    if (!signedIn || !landscape.reviews || landscape.refreshing) return;
    landscape.refreshing = true;
    const epoch = authEpoch;
    const changes = landscape.changes;
    try {
      const reviews = await cloud.loadReviews();
      if (epoch !== authEpoch || !landscape.reviews || landscape.changes !== changes) return;
      const snapshot = (r) => JSON.stringify([...r].sort());
      const before = snapshot(landscape.reviews);
      landscape.reviews = reviews;
      if (snapshot(reviews) !== before) renderLandscape();
    } catch {
      // Offline or signed out; the next return tries again.
    } finally {
      landscape.refreshing = false;
    }
  }

  // Stops reviews of ideas no longer in this tab (or all, on sign-out): nobody
  // would see them, and Meta would go on billing for them.
  function stopOrphanReviews(all = false) {
    for (const [id, controller] of landscape.stops) if (all || !state.ideas.some((i) => i.id === id)) controller.abort();
  }

  function forgetLandscape() {
    stopOrphanReviews(true);
    Object.assign(landscape, {
      reviews: null,
      reports: new Map(),
      open: new Map(),
      loading: new Set(),
      working: new Set(),
      busy: new Map(),
      stops: new Map(),
      messages: new Map(),
      asking: null,
      applied: new Set(),
      loadError: '',
      refreshing: false,
      changes: 0,
    });
  }

  // Researches the idea's competition and keeps the review.
  async function runLandscape() {
    const idea = selected();
    if (!idea || !landscape.reviews || landscape.busy.has(idea.id)) return;
    const { key: models, provider } = reviewChoice();
    const providerInfo = landingLib.PROVIDERS[provider];
    const key = reviewKey(provider);
    if (!key) return openVault(`Add your ${providerInfo.name} key to review the competition.`, provider);
    if (!landingLib.hasNotes(idea)) {
      return setLandscapeMessage(idea.id, 'Write some notes first: what the idea is, who it is for and why now. The research starts from them.', 'error');
    }
    if (reviewLimitText()) return setLandscapeMessage(idea.id, reviewLimitText(), 'error');
    const epoch = authEpoch;
    const controller = new AbortController();
    landscape.busy.set(idea.id, { step: 'starting', done: 0, total: 0, searches: 0, models });
    landscape.stops.set(idea.id, controller);
    landscape.messages.delete(idea.id);
    landscape.asking = null;
    renderLandscape();
    const gone = () => !state.ideas.some((i) => i.id === idea.id);
    // Updates the progress line in place, so the panel isn't redrawn on every event.
    const onProgress = (progress) => {
      if (epoch !== authEpoch || !landscape.busy.has(idea.id)) return;
      if (gone()) return controller.abort();
      landscape.busy.set(idea.id, { ...progress, models });
      if (selected()?.id === idea.id) {
        const line = $('#landscape-progress');
        if (line) line.textContent = landscapeProgressText(landscape.busy.get(idea.id));
        const stepper = $('#landscape-stepper');
        if (stepper) stepper.dataset.step = progress.step || 'starting';
      }
    };
    let message = null;
    try {
      // A review belongs to the idea's saved row, so the idea is saved first.
      await flushSync();
      if (sync.synced.get(idea.id) !== JSON.stringify(idea)) {
        throw new Error(
          sync.refused.has(idea.id)
            ? "This idea can't be saved to your account, so it can't be reviewed yet. Edit it so it saves, then try again."
            : "This idea isn't saved to your account yet. Check your connection and try again."
        );
      }
      if (epoch !== authEpoch) return;
      const answer = await cloud.review(key, idea, models, onProgress, controller.signal);
      if (epoch !== authEpoch || gone()) return;
      if (!answer.report) throw new Error('The review was cut off before it finished. Try again.');
      const { report, problems } = landscapeLib.checkReport(answer.report);
      if (problems.length) throw new Error(`The review couldn't be used: ${problems.join('; ')}. Try again.`);
      let saved;
      try {
        saved = await cloud.saveReview(idea.id, report.models.lead || landscapeLib.MODELS.lead, report);
      } catch (err) {
        if (err.code === '23514' && /reviews/.test(err.message)) throw new Error(REVIEWS_FULL);
        throw err;
      }
      if (epoch !== authEpoch || gone()) return;
      landscape.reviews.set(idea.id, [saved, ...reviewsOf(idea.id).filter((r) => r.id !== saved.id)]);
      landscape.reports.set(saved.id, report);
      landscape.open.set(idea.id, saved.id);
      landscape.changes++;
      message = { text: `Review ready: ${report.competitors.length} competitors, from ${report.searches} web searches.`, kind: 'ok' };
    } catch (err) {
      if (epoch !== authEpoch || gone() || (await leftForRemovedAccess(err, epoch))) return;
      message = err.stopped ? { text: 'Stopped. Nothing was kept.', kind: 'ok' } : { text: generateErrorText(err, providerInfo.name), kind: 'error' };
    } finally {
      if (epoch === authEpoch) {
        landscape.busy.delete(idea.id);
        landscape.stops.delete(idea.id);
        if (message) landscape.messages.set(idea.id, message);
        renderLandscape();
      }
    }
  }

  // Shows a review, loading it the first time; or hides it.
  async function toggleReview(reviewId) {
    const idea = selected();
    if (!idea) return;
    if (landscape.open.get(idea.id) === reviewId) {
      landscape.open.delete(idea.id);
      return renderLandscape();
    }
    landscape.open.set(idea.id, reviewId);
    landscape.asking = null;
    if (landscape.reports.has(reviewId) || landscape.loading.has(reviewId)) return renderLandscape();
    const epoch = authEpoch;
    landscape.loading.add(reviewId);
    renderLandscape();
    try {
      const { report, problems } = landscapeLib.checkReport(await cloud.loadReview(reviewId));
      if (epoch !== authEpoch) return;
      if (problems.length) throw new Error(`it can't be shown (${problems.join('; ')})`);
      landscape.reports.set(reviewId, report);
    } catch (err) {
      if (epoch !== authEpoch || (await leftForRemovedAccess(err, epoch))) return;
      if (landscape.open.get(idea.id) === reviewId) landscape.open.delete(idea.id);
      landscape.messages.set(idea.id, { text: `The review could not be loaded: ${err.message}`, kind: 'error' });
    } finally {
      landscape.loading.delete(reviewId);
      if (epoch === authEpoch && selected()?.id === idea.id) renderLandscape();
    }
  }

  async function deleteReview(reviewId) {
    const idea = selected();
    if (!idea || landscape.working.has(reviewId)) return;
    const epoch = authEpoch;
    landscape.asking = null;
    landscape.working.add(reviewId);
    renderLandscape();
    let message = null;
    try {
      await cloud.deleteReview(reviewId);
      if (epoch !== authEpoch) return;
      landscape.reviews.set(idea.id, reviewsOf(idea.id).filter((r) => r.id !== reviewId));
      landscape.reports.delete(reviewId);
      if (landscape.open.get(idea.id) === reviewId) landscape.open.delete(idea.id);
      landscape.changes++;
      message = { text: 'Review deleted.', kind: 'ok' };
    } catch (err) {
      if (epoch !== authEpoch || (await leftForRemovedAccess(err, epoch))) return;
      message = { text: `The review could not be deleted: ${err.message}`, kind: 'error' };
    } finally {
      if (epoch === authEpoch) {
        landscape.working.delete(reviewId);
        if (message) landscape.messages.set(idea.id, message);
        if (selected()?.id === idea.id) renderLandscape();
      }
    }
  }

  // Applies a review's proposal to the idea, checked again first.
  function applyReview(reviewId) {
    const idea = selected();
    const report = landscape.reports.get(reviewId);
    landscape.asking = null;
    if (!idea || !report) return renderLandscape();
    const { before, after, problems } = coachLib.checkProposal(landscapeLib.proposalArgs(report, idea.id), state.ideas);
    if (problems.length || !before) return renderLandscape();
    landscape.applied.add(reviewId);
    landscape.messages.set(idea.id, { text: 'Applied. The scorecard below shows the new stars and notes.', kind: 'ok' });
    // Draws the whole editor again, this panel included.
    applyFields(idea.id, after);
  }

  // The panel's buttons, inside the idea's editor.
  function landscapeAction(action, button) {
    const reviewId = button?.closest('[data-review]')?.dataset.review;
    switch (action) {
      case 'landscape-run':
        return runLandscape();
      case 'landscape-stop':
        return landscape.stops.get(selected()?.id)?.abort();
      case 'landscape-key':
        return openSettings({ focus: '#landscape-model' });
      case 'landscape-reload':
        return loadLandscape();
      case 'landscape-open':
        return toggleReview(reviewId);
      case 'landscape-ask-delete':
      case 'landscape-ask-apply':
        landscape.asking = { ideaId: selected().id, reviewId, action: action === 'landscape-ask-delete' ? 'delete' : 'apply' };
        renderLandscape();
        return $(`[data-action="landscape-keep"][data-review="${CSS.escape(reviewId)}"]`)?.focus();
      case 'landscape-keep': {
        const was = landscape.asking;
        landscape.asking = null;
        renderLandscape();
        return $(`[data-action="${was?.action === 'apply' ? 'landscape-ask-apply' : 'landscape-ask-delete'}"][data-review="${CSS.escape(reviewId)}"]`)?.focus();
      }
      case 'landscape-delete':
        return deleteReview(reviewId);
      case 'landscape-apply':
        return applyReview(reviewId);
    }
  }

  // The models reviews run on: the same choice as landing pages' and
  // Coach's in Settings, with a pair of models per option.
  modelSetting('landscape', landscapeKeys, () => renderLandscape(), REVIEW_CHOICES);

  // ---------- Import ----------

  const importDialog = $('#import-dialog');
  const importFile = $('#import-file');
  const importText = $('#import-text');
  const importResult = $('#import-result');
  const runImport = $('#run-import');
  let pending = null;
  // Replacing deletes every idea first, so it takes a second click after a
  // quiet moment. Each click too soon restarts the wait, so neither a
  // double-click nor a held Enter key (which repeats clicks) confirms it.
  let replaceArmed = false;
  let replaceArmedAt = 0;
  const CONFIRM_PAUSE = 800;

  function showImportResult(message, kind) {
    importResult.textContent = message;
    importResult.className = 'import-result' + (kind ? ` is-${kind}` : '');
  }

  function describe(result) {
    const n = result.ideas.length;
    const skipped = result.tooBig || [];
    const one = skipped.length === 1;
    const tooBig = skipped.length
      ? `${skipped.length} idea${one ? ' is' : 's are'} too big for an account (over 128 KB), so ${one ? 'it is' : 'they are'} left out: ${skipped.slice(0, 5).map((name) => `“${[...name].slice(0, 60).join('')}”`).join(', ')}${skipped.length > 5 ? ' and more' : ''}. Shorten ${one ? 'its' : 'their'} notes in the file to import ${one ? 'it' : 'them'}.`
      : '';
    if (!n) return tooBig || 'No ideas with a name were found.';
    return `Found ${n} idea${n === 1 ? '' : 's'}.${tooBig ? ` ${tooBig}` : ''}`;
  }

  // Why importing these would go past the most ideas an account holds, if it would.
  function tooManyText(result) {
    const n = result.ideas.length;
    const max = core.MAX_IDEAS;
    if ($('#import-replace').checked) return n > max ? `This backup has ${n} ideas, and an account holds at most ${max}.` : '';
    const total = state.ideas.length + n;
    return total > max
      ? `Adding these ${n} would make ${total} ideas, and an account holds at most ${max}. Delete some first, or choose Replace all ideas.`
      : '';
  }

  function setPending(result) {
    pending = result;
    replaceArmed = false;
    syncImportLabel();
    const tooMany = result && result.ideas.length ? tooManyText(result) : '';
    runImport.disabled = !result || !result.ideas.length || !!tooMany;
    if (result) {
      if (tooMany) showImportResult(tooMany, 'error');
      else showImportResult(describe(result), result.ideas.length ? 'ok' : 'error');
    }
  }

  async function readFile(file) {
    $('#import-file-name').textContent = file.name;
    showImportResult('Reading…');
    setPending(null);
    try {
      // Checked before reading, so a huge file doesn't freeze the page.
      if (file.size > core.MAX_IMPORT_BYTES) throw new Error(core.TOO_BIG_TO_IMPORT);
      setPending(core.parseImport(await file.text(), { forAccount: cloud.enabled }));
    } catch (err) {
      showImportResult(err.message, 'error');
    }
  }

  function openImport() {
    $('#import-add').checked = true;
    importFile.value = '';
    importText.value = '';
    $('#import-file-name').textContent = '.json';
    setPending(null);
    showImportResult('');
    importDialog.showModal();
  }
  $('#open-import').addEventListener('click', openImport);

  importFile.addEventListener('change', () => {
    if (importFile.files[0]) readFile(importFile.files[0]);
  });

  const drop = $('.file-drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });

  importText.addEventListener('input', () => {
    if (!importText.value.trim()) {
      setPending(null);
      return showImportResult('');
    }
    try {
      setPending(core.parseImport(importText.value, { forAccount: cloud.enabled }));
    } catch (err) {
      setPending(null);
      showImportResult(err.message, 'error');
    }
  });

  function syncImportLabel() {
    const replace = $('#import-replace').checked;
    runImport.textContent = replace ? (replaceArmed ? 'Yes, replace all ideas' : 'Replace all ideas') : 'Import';
    runImport.classList.toggle('btn-danger-solid', replace);
  }
  // Changing the mode starts over: the found ideas again, and no armed Replace.
  $('#import-add').addEventListener('change', () => setPending(pending));
  $('#import-replace').addEventListener('change', () => setPending(pending));

  runImport.addEventListener('click', () => {
    if (!pending || !pending.ideas.length) return;
    // Checked again now: ideas may have arrived from another device since.
    const tooMany = tooManyText(pending);
    if (tooMany) {
      runImport.disabled = true;
      return showImportResult(tooMany, 'error');
    }
    const replace = $('#import-replace').checked;
    if (replace && state.ideas.length && replaceArmed && Date.now() - replaceArmedAt < CONFIRM_PAUSE) {
      replaceArmedAt = Date.now();
      return;
    }
    if (replace && state.ideas.length && !replaceArmed) {
      replaceArmed = true;
      replaceArmedAt = Date.now();
      syncImportLabel();
      const n = state.ideas.length;
      const m = pending.ideas.length;
      showImportResult(
        `This deletes all ${n} of your current idea${n === 1 ? '' : 's'}${signedIn ? ' from your account' : ''} and keeps only the ${m} from the backup. Click "Yes, replace all ideas" to go ahead.`,
        'error'
      );
      return;
    }
    state.ideas = replace ? pending.ideas : [...pending.ideas, ...state.ideas];
    stopOrphanDrafts();
    state.query = state.status = state.tag = '';
    els.search.value = '';
    save();
    importDialog.close();
    state.selectedId = isNarrow() ? null : pending.ideas[0].id;
    els.workbench.classList.remove('show-editor');
    pending = null;
    // Import is under Settings, so show the ideas it brought.
    if (state.view === 'settings') {
      settings.from = null;
      setView('ideas');
    }
    renderAll();
  });

  // On the sign-in screen nothing of the last account stays on screen: an open
  // backup or import is closed and emptied, and Settings shows no keys.
  function closeDataDialogs() {
    clearVault();
    if (state.view === 'settings') {
      settings.from = null;
      setView('ideas');
    }
    if (exportDialog.open) exportDialog.close();
    exportText.value = '';
    if (importDialog.open) importDialog.close();
    importFile.value = '';
    importText.value = '';
    setPending(null);
    showImportResult('');
  }

  // ---------- Accounts and cloud sync ----------

  // A moment after each change, changed ideas are saved to the account and
  // deleted ones removed. `synced` holds what the database has, so only the
  // differences are sent; a failed save is retried. `versions` holds the
  // version the database has of each idea (when its row was last written),
  // which each save and delete must still find there, so nothing changed in
  // another tab or on another device meanwhile is overwritten. `refused` holds
  // ideas the database turned down as they are; they aren't sent again until
  // they change. `failures` counts failed saves in a row, for the wait before
  // the next try. `note` is said once, after the next save, next to "Saved".
  // `unsure` holds, per idea, the copies sent since its last answered save
  // whose save got no answer: one may have landed, so a merge starts from them too.
  // `sending` holds, per idea, the copy whose save is on its way, until it is
  // answered (or moves to `unsure`): changes kept meanwhile start from it too.
  const sync = { synced: new Map(), versions: new Map(), unsure: new Map(), sending: new Map(), refused: new Map(), timer: null, busy: false, again: false, stopped: false, failures: 0, note: '' };
  const SYNC_TEXT = { saving: 'Saving…', saved: 'Saved', error: 'Not saved yet, retrying…' };
  const snapshot = (ideas) => new Map(ideas.map((i) => [i.id, JSON.stringify(i)]));

  function setSyncStatus(kind) {
    const el = $('#sync-status');
    el.textContent = SYNC_TEXT[kind] || '';
    el.dataset.state = kind;
    el.title = '';
  }

  // The database's refusal of an idea for want of room in the account.
  const FULL = /at most \d+ ideas/;

  // The database checks for room before size, so an idea too big to save can
  // be refused for want of room first. Such an idea counts as too long, so
  // nothing is deleted to make room for it.
  const TOO_BIG = 'Too big for the database (ideas_data_size), so nothing is deleted to make room for it.';
  const tooBig = (json) => core.tooBigToSave(JSON.parse(json));

  // Ideas deleted made room: those refused for want of it are sent again.
  function roomMade() {
    let freed = false;
    for (const [id, { reason }] of sync.refused) {
      if (!FULL.test(reason)) continue;
      sync.refused.delete(id);
      freed = true;
    }
    if (freed) sync.again = true;
  }

  // Why the database refused ideas: too long, too many, or something else.
  function refusedKind() {
    const reasons = [...sync.refused.values()].map((r) => r.reason);
    if (reasons.every((r) => /ideas_data_size/.test(r))) return 'long';
    if (reasons.every((r) => FULL.test(r))) return 'many';
    return 'other';
  }

  // Names what the database refused, for the header and the sign-out message.
  function refusedText() {
    const n = sync.refused.size;
    const kind = refusedKind();
    if (kind === 'many') return 'Your account holds too many ideas to save more';
    const why = kind === 'long' ? 'is too long to save' : "can't be saved";
    if (n > 1) return `${n} ideas ${kind === 'long' ? 'are too long to save' : "can't be saved"}`;
    const idea = state.ideas.find((i) => sync.refused.has(i.id));
    const name = idea ? [...idea.name] : [...'An idea'];
    return `"${name.length > 30 ? `${name.slice(0, 29).join('')}…` : name.join('')}" ${why}`;
  }

  function showSaved() {
    if (!sync.refused.size) {
      setSyncStatus('saved');
      if (sync.note) $('#sync-status').textContent = `Saved. ${sync.note}`;
      sync.note = '';
      return;
    }
    setSyncStatus('error');
    const el = $('#sync-status');
    const kind = refusedKind();
    el.textContent = `${refusedText()}. ${kind === 'long' ? 'Shorten its notes.' : kind === 'many' ? 'Delete some ideas.' : 'Edit or delete it.'}`;
    el.title = [...sync.refused.values()].map((r) => r.reason).join('\n');
  }

  // Saves the changed ideas as they were in `current` (the snapshot this save
  // took), and returns the ones the database refused (id -> reason) and those
  // changed or deleted elsewhere meanwhile (ids). Each one saved counts as
  // saved at once, even if a later one fails. Ideas the account doesn't have
  // yet are added in one request; if the database refuses that, they are added
  // one by one so a single bad idea can't hold back the others. Each idea it
  // has is saved over the version this tab last saw.
  // A save that got no answer may have landed: what it sent is kept, so a
  // later merge doesn't count it as changed here. A few of the latest are kept.
  function mayHaveLanded(id, json) {
    const copies = (sync.unsure.get(id) ?? []).filter((copy) => copy !== json);
    sync.unsure.set(id, [...copies, json].slice(-10));
  }

  // Runs a request that sends these copies (id -> JSON), keeping them in
  // `sync.sending` until it is answered.
  async function sending(copies, request) {
    for (const [id, json] of copies) sync.sending.set(id, json);
    try {
      return await request();
    } finally {
      for (const [id, json] of copies) if (sync.sending.get(id) === json) sync.sending.delete(id);
    }
  }

  async function saveChanged(ideas, current) {
    const refused = new Map();
    const conflicts = [];
    const sent = (idea) => JSON.parse(current.get(idea.id));
    const saved = (id, version) => {
      sync.versions.set(id, version);
      sync.synced.set(id, current.get(id));
      sync.unsure.delete(id);
      sync.refused.delete(id);
    };
    const add = async (batch) => {
      let versions;
      try {
        versions = await sending(batch.map((idea) => [idea.id, current.get(idea.id)]), () => cloud.addIdeas(batch.map(sent)));
      } catch (err) {
        if (!cloud.isRefused(err) && !cloud.isDuplicate(err)) for (const idea of batch) mayHaveLanded(idea.id, current.get(idea.id));
        throw err;
      }
      for (const [id, version] of versions) saved(id, version);
    };
    // Why one idea wasn't added: it's there already (a save whose answer was lost), or refused.
    const notAdded = (idea, err) => {
      if (cloud.isDuplicate(err)) conflicts.push(idea.id);
      else if (cloud.isRefused(err)) refused.set(idea.id, err.message);
      else throw err;
    };
    const added = ideas.filter((i) => !sync.versions.has(i.id));
    if (added.length) {
      try {
        await add(added);
      } catch (err) {
        if (!cloud.isRefused(err) && !cloud.isDuplicate(err)) throw err;
        if (added.length === 1) notAdded(added[0], err);
        else {
          for (const idea of added) {
            try {
              await add([idea]);
            } catch (e) {
              notAdded(idea, e);
            }
          }
        }
      }
    }
    for (const idea of ideas.filter((i) => !added.includes(i))) {
      try {
        const version = await sending([[idea.id, current.get(idea.id)]], () => cloud.saveIdea(sent(idea), sync.versions.get(idea.id)));
        if (version) saved(idea.id, version);
        else conflicts.push(idea.id);
      } catch (e) {
        if (!cloud.isRefused(e)) {
          mayHaveLanded(idea.id, current.get(idea.id));
          throw e;
        }
        refused.set(idea.id, e.message);
      }
    }
    return { refused, conflicts };
  }

  // Deletes the ideas deleted here, a few at a time, each only if the account
  // still has the version this tab last saw. Returns those changed or deleted
  // elsewhere meanwhile.
  async function deleteRemoved(ids) {
    const conflicts = [];
    for (let i = 0; i < ids.length; i += 6) {
      await Promise.all(
        ids.slice(i, i + 6).map(async (id) => {
          if (!(await cloud.deleteIdea(id, sync.versions.get(id)))) return conflicts.push(id);
          sync.synced.delete(id);
          sync.versions.delete(id);
          sync.unsure.delete(id);
          // Room made at once, even if a later delete fails.
          roomMade();
        })
      );
    }
    return conflicts;
  }

  // Ideas saved or deleted elsewhere since this tab last saw them (`current`
  // is what this save sent). One changed in both places keeps both changes,
  // part by part (core.mergeIdeas), and this tab's where both changed the same
  // part. One deleted elsewhere stays deleted, and one deleted here but changed
  // elsewhere stays, as when changes kept from a sign-out are saved
  // (restoreUnsaved); either is said next to "Saved". Ideas settled are shown
  // at once, even if a later one fails. Returns whether one changed elsewhere
  // yet again while it was settled (`again`), or null if the tab left the account.
  async function settleConflicts(ids, current) {
    const changedHere = new Set();
    let again = false;
    const notes = [];
    const quoted = (idea) => `“${[...idea.name].length > 30 ? `${[...idea.name].slice(0, 29).join('')}…` : idea.name}”`;
    try {
      for (const id of ids) {
        const theirs = await cloud.loadIdea(id);
        if (!signedIn) return null;
        // A user whose access was removed finds nothing, rather than being refused.
        if (!theirs && (await cloud.accessRemoved())) {
          if (signedIn) await leaveRemovedAccess('Your access to this app was removed, so your last changes were not saved.');
          return null;
        }
        const sent = current.has(id) ? JSON.parse(current.get(id)) : null;
        // A new idea refused as already there, though the account has no such
        // idea and this tab never sent it before: its id is held by another
        // account (ids are unique across accounts, and the database hides
        // other accounts' rows). It is given a new id, and added under it next.
        if (!theirs && sent && !sync.versions.has(id) && !sync.unsure.has(id)) {
          const moved = giveNewId(id);
          if (moved) changedHere.add(moved);
          continue;
        }
        if (!theirs) {
          sync.synced.delete(id);
          sync.versions.delete(id);
          sync.unsure.delete(id);
          sync.refused.delete(id);
          // Deleted here and already gone (a delete whose answer was lost): room made.
          if (!sent) roomMade();
          if (sent) {
            state.ideas = state.ideas.filter((i) => i.id !== id);
            changedHere.add(id);
            notes.push(`${quoted(sent)} was deleted on another device, so your change to it wasn't saved.`);
          }
          continue;
        }
        const idea = core.sanitizeIdea(theirs.idea);
        // Deleted here, and what the account has is a copy this tab sent without
        // an answer: nothing changed it elsewhere, so it is deleted after all.
        if (!sent && (sync.unsure.get(id) ?? []).some((copy) => sameContent(JSON.parse(copy), idea))) {
          const deleted = await cloud.deleteIdea(id, theirs.version);
          if (!signedIn) return null;
          if (!deleted) {
            again = true;
            continue;
          }
          sync.synced.delete(id);
          sync.versions.delete(id);
          sync.unsure.delete(id);
          sync.refused.delete(id);
          roomMade();
          continue;
        }
        if (!sent) {
          state.ideas.push(idea);
          sync.synced.set(id, JSON.stringify(idea));
          sync.versions.set(id, theirs.version);
          sync.unsure.delete(id);
          sync.refused.delete(id);
          changedHere.add(id);
          notes.push(`${quoted(idea)} was changed on another device after you deleted it here, so it was kept.`);
          continue;
        }
        // The copy both started from: the one last saved, or any copy sent
        // since whose save got no answer (one of them may have landed).
        const starts = [sync.synced.get(id), ...(sync.unsure.get(id) ?? [])].filter(Boolean);
        const merged = core.mergeIdeas(starts.length ? starts.map((json) => JSON.parse(json)) : null, sent, idea);
        // A change of its own, later than either, so other devices load it.
        merged.updatedAt = new Date(Math.max(Date.now(), Date.parse(merged.updatedAt) + 1)).toISOString();
        let version = null;
        let unanswered = null;
        try {
          version = await sending([[id, JSON.stringify(merged)]], () => cloud.saveIdea(merged, theirs.version));
        } catch (err) {
          if (cloud.isRefused(err)) throw err;
          // It may have landed: it's shown here all the same, and kept to merge from.
          mayHaveLanded(id, JSON.stringify(merged));
          unanswered = err;
        }
        if (!signedIn) return null;
        if (!version && !unanswered) {
          again = true;
          continue;
        }
        if (version) {
          sync.versions.set(id, version);
          sync.synced.set(id, JSON.stringify(merged));
          sync.unsure.delete(id);
          // Saved at last: a refusal of an earlier copy no longer stands.
          sync.refused.delete(id);
        }
        const at = state.ideas.findIndex((i) => i.id === id);
        if (at !== -1) {
          // What was typed here meanwhile goes on top of the merged copy.
          const latest = core.mergeIdeas(sent, state.ideas[at], merged);
          if (sameContent(latest, merged)) state.ideas[at] = merged;
          else {
            // A change of its own, so it reads as later than the merged copy.
            latest.updatedAt = new Date(Math.max(Date.now(), Date.parse(merged.updatedAt) + 1)).toISOString();
            state.ideas[at] = latest;
          }
          changedHere.add(id);
        }
        if (unanswered) throw unanswered;
      }
    } finally {
      // What was settled shows at once, even if a later idea failed to load or save.
      if (signedIn) {
        if (notes.length) sync.note = [sync.note, ...notes].filter(Boolean).join(' ');
        if (changedHere.size) showSettled(changedHere);
      }
    }
    return { again };
  }

  // Gives an idea a new id here, everywhere this tab refers to it, and returns
  // it (null if the idea is gone meanwhile). Its next save adds it under it.
  function giveNewId(id) {
    const at = state.ideas.findIndex((i) => i.id === id);
    if (at === -1) return null;
    const moved = core.sanitizeIdea({ ...state.ideas[at], id: '' });
    state.ideas[at] = moved;
    // A kept change under the old id is forgotten once the idea is saved under the new one.
    movedTo.set(id, moved.id);
    if (state.selectedId === id) state.selectedId = moved.id;
    // A copy made from a kept change is still waiting to be saved under its new id.
    if (copiedFrom.has(id)) {
      copiedFrom.set(moved.id, copiedFrom.get(id));
      copiedFrom.delete(id);
    }
    // Coach's "Open it" on a card that saved it still finds it.
    let coachChanged = false;
    for (const conversation of coach.conversations) {
      for (const outcome of Object.values(conversation.outcomes ?? {})) {
        if (outcome.ideaId !== id) continue;
        outcome.ideaId = moved.id;
        coachChanged = true;
      }
    }
    if (coachChanged) saveCoach();
    return moved.id;
  }

  // What a field's text is saved as, to tell whether two texts mean the same.
  function fieldMeaning(field, value) {
    if (field.id === 'idea-tags') return JSON.stringify(core.normalizeTags(value));
    if (field.id === 'idea-name') return core.cleanText(value).trim() || 'Name your idea here';
    if (field.dataset.note) return value.trim() ? core.cleanText(value) : '';
    return core.cleanText(value);
  }

  // Shows ideas that changed in this tab without a person changing them (a
  // save that met changes made elsewhere), keeping the field being edited.
  function showSettled(ids) {
    edits++;
    stopOrphanDrafts();
    renderFilters();
    const before = state.selectedId;
    if (!selected()) {
      state.selectedId = isNarrow() ? null : visibleIdeas()[0]?.id ?? null;
      els.workbench.classList.remove('show-editor');
    }
    // While the same idea is shown, its fields keep what was typed in them:
    // text past a field's limit (it isn't saved), and text saved in a tidier
    // form, such as tags with a trailing comma or a note that is only spaces.
    const same = state.selectedId === before;
    const drafts = same ? [...els.editor.querySelectorAll('input[id], textarea[id]')].map((el) => [el.id, el.value, !!el.dataset.unsaved]) : [];
    // Line notes opened here stay open, so text kept in them isn't hidden.
    const openNotes = same ? [...els.editor.querySelectorAll('[data-note-toggle][aria-expanded="true"]')].map((b) => b.dataset.noteToggle) : [];
    keepFocus(() => {
      renderList();
      // The idea shown changed, or another is shown now: the editor always shows the selected one.
      if (ids.has(state.selectedId) || state.selectedId !== before) {
        renderEditor();
        for (const [id, value, unsaved] of drafts) {
          const field = document.getElementById(id);
          if (!field || field.value === value || (!unsaved && fieldMeaning(field, value) !== fieldMeaning(field, field.value))) continue;
          field.value = value;
          checkLength(field);
        }
        for (const id of openNotes) {
          const button = els.editor.querySelector(`[data-note-toggle="${id}"]`);
          if (button) setNote(button, true);
        }
        fitName();
      }
      if (state.view === 'matrix') renderMatrix();
    });
  }

  function scheduleSync() {
    if (sync.stopped) return;
    clearTimeout(sync.timer);
    setSyncStatus('saving');
    sync.timer = setTimeout(runSync, 700);
  }

  // `asked` is true for a save someone asked for (signing out): its failures
  // don't make the automatic retries wait longer.
  async function runSync(asked = false) {
    clearTimeout(sync.timer);
    sync.timer = null;
    if (!signedIn) return;
    if (sync.busy) {
      sync.again = true;
      return;
    }
    sync.busy = true;
    const current = snapshot(state.ideas);
    const changed = state.ideas.filter(
      (i) => sync.synced.get(i.id) !== current.get(i.id) && sync.refused.get(i.id)?.json !== current.get(i.id)
    );
    const removed = [...sync.synced.keys()].filter((id) => !current.has(id));
    try {
      const { refused, conflicts } = await saveChanged(changed, current);
      // Signed out meanwhile (for example in another tab): the page was emptied,
      // so recording this save would make its ideas look deleted.
      if (!signedIn) return;
      for (const [id, reason] of refused) sync.refused.set(id, { json: current.get(id), reason: FULL.test(reason) && tooBig(current.get(id)) ? TOO_BIG : reason });
      for (const id of sync.refused.keys()) if (!current.has(id)) sync.refused.delete(id);
      // Nothing is deleted while the database refuses an idea: after Replace
      // all, the old ideas stay until the ideas replacing them are saved. Unless
      // it refuses them only for want of room, which deleting makes: then the
      // ideas it refused are sent again.
      if (!sync.refused.size || refusedKind() === 'many') {
        conflicts.push(...(await deleteRemoved(removed)));
        if (!signedIn) return;
      }
      if (conflicts.length) {
        const outcome = await settleConflicts(conflicts, current);
        if (!outcome) return;
        // Changed elsewhere once more while it was settled: tried again after the usual wait.
        if (outcome.again) throw new Error('An idea changed on another device while it was being saved.');
        // Typed here while that was settled: saved next.
        if (changesPending()) sync.again = true;
      }
      sync.failures = 0;
      // A newer change is already waiting, so it isn't "Saved" yet.
      if (sync.timer !== null || sync.again) setSyncStatus('saving');
      else showSaved();
      if (!sync.refused.size && !changesPending()) forgetUnsaved();
      else forgetSaved();
    } catch (err) {
      if (!signedIn) return;
      forgetSaved();
      // A refusal is only taken as removed access once the database confirms it.
      if (cloud.isAccessDenied(err) && (await cloud.accessRemoved())) {
        if (signedIn) await leaveRemovedAccess('Your access to this app was removed, so your last changes were not saved.');
        return;
      }
      if (!signedIn) return;
      setSyncStatus('error');
      if (!asked) sync.failures++;
      sync.timer = setTimeout(runSync, retryDelay(Math.max(sync.failures, 1)));
    } finally {
      sync.busy = false;
      if (sync.again) {
        sync.again = false;
        scheduleSync();
      }
    }
  }

  // Waits longer after each failure in a row (5 s, 10 s, 20 s … up to 5
  // minutes), give or take a fifth so tabs don't retry in step. Coming back
  // online, leaving the page or a new change still saves at once.
  function retryDelay(failures) {
    const delay = Math.min(5000 * 2 ** (failures - 1), 5 * 60 * 1000);
    return Math.round(delay * (0.8 + Math.random() * 0.4));
  }

  const hasUnsaved = () => signedIn && (sync.timer !== null || sync.busy || sync.refused.size > 0);

  // True while some change hasn't reached the account yet.
  function changesPending() {
    const current = snapshot(state.ideas);
    return (
      state.ideas.some((i) => sync.synced.get(i.id) !== current.get(i.id)) ||
      [...sync.synced.keys()].some((id) => !current.has(id))
    );
  }

  const nextTick = () => new Promise((resolve) => setTimeout(resolve, 100));

  // Saves everything now, waiting for a save already running. Gives up after
  // a few failed tries and reports whether everything reached the account.
  async function flushSync() {
    for (let attempt = 0; attempt < 3; attempt++) {
      while (sync.busy) await nextTick();
      if (!changesPending()) return true;
      await runSync(true);
    }
    while (sync.busy) await nextTick();
    return !changesPending();
  }

  // Changes not saved yet are kept on this device, per account, and saved after
  // the next sign-in: when this tab is signed out without asking (in another
  // tab, or because the sign-in ended), and whenever the page is hidden or
  // left, since a phone may then discard it without a word. Each tab keeps
  // its own (`unsaved/<user id>/<tab>`), rewritten each time with what it has
  // not saved now, so one tab's saves never forget another tab's changes.
  const UNSAVED_KEY = 'ideation-calculator/unsaved/';
  // crypto.randomUUID is missing on pages opened from a file.
  const TAB_ID = crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint32Array(4))].join('-');
  const ownUnsavedKey = () => `${UNSAVED_KEY}${account.id}/${TAB_ID}`;
  // What each tab's (and an older version's) kept changes held when this tab
  // read them at sign-in: forgotten once saved, unless rewritten since.
  let readUnsaved = new Map();
  // The copies restoreUnsaved made from kept changes (copy id -> the idea it
  // was made from), until each is saved or deleted: till then the kept change
  // it came from isn't forgotten, as the copy may not be kept anywhere else.
  let copiedFrom = new Map();
  // New ideas a kept change brought back at sign-in though their add may
  // have landed before (so they may have been deleted elsewhere since): kept
  // as such again, so the next sign-in says so too.
  let mayBeSent = new Set();
  // Ideas given a new id here because another account holds theirs (old id -> new id).
  const movedTo = new Map();

  function unsavedKeys() {
    const mine = UNSAVED_KEY + account.id;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === mine || key?.startsWith(`${mine}/`)) keys.push(key);
    }
    return keys;
  }

  // Returns how many ideas have changes kept (`kept`), or could not be kept
  // because the browser's storage is full (`lost`). For each one it also keeps
  // when the account's copy it started from was saved (`base`; null for an idea
  // the account doesn't have yet), so the next sign-in can tell whether that
  // copy changed on another device in the meantime, and for a changed idea that
  // copy itself, with any sent since whose save got no answer or is on its way
  // (`starts`): if the account then has one of them, the change goes in whole
  // rather than as a copy (restoreUnsaved). When storage is full, the starting
  // copies go first (all but one for each idea, then that one: without them a
  // change whose save landed is saved as a copy it didn't need), then the
  // oldest Coach conversations make room: unsaved ideas matter more. If the
  // changes still don't fit, the conversations are put back: losing them
  // would gain nothing.
  function keepUnsaved() {
    const none = { kept: 0, lost: 0 };
    if (!account) return none;
    const current = snapshot(state.ideas);
    const changed = state.ideas.filter((i) => sync.synced.get(i.id) !== current.get(i.id));
    const deleted = [...sync.synced.keys()].filter((id) => !current.has(id));
    const count = changed.length + deleted.length;
    if (!count) return none;
    const savedAt = (id) => (sync.synced.has(id) ? JSON.parse(sync.synced.get(id)).updatedAt ?? '' : null);
    const startsOf = (id) => [sync.synced.get(id), ...(sync.unsure.get(id) ?? []), sync.sending.get(id)].filter(Boolean).map((json) => JSON.parse(json));
    const key = ownUnsavedKey();
    const coachKey = COACH_STORE + account.id;
    let storedCoach = null;
    try {
      storedCoach = localStorage.getItem(coachKey);
    } catch {
      // Storage can't be read: nothing to put back.
    }
    const conversations = coach.conversations;
    // A change kept earlier keeps the copy it started from.
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      // Unreadable: kept afresh.
    }
    const earlier = stored?.base || {};
    const earlierStarts = stored?.starts || {};
    const earlierSent = new Set(Array.isArray(stored?.sent) ? stored.sent : []);
    const base = {};
    // The copy this tab last saved, or for an idea not saved since it was
    // first kept, the one kept then.
    for (const { id } of changed) base[id] = sync.synced.has(id) ? savedAt(id) : Object.hasOwn(earlier, id) ? earlier[id] : null;
    // A deletion is sent against the copy this tab last saved, which it always has.
    for (const id of deleted) base[id] = savedAt(id);
    // Ideas the account didn't have when this tab loaded or last saved them,
    // whose add may have landed all the same (sent without an answer, or on
    // its way): if the account doesn't have one at the next sign-in, it may
    // have been deleted elsewhere since, and that sign-in says so. Kept in
    // every form of the record, as it takes little room.
    const sent = changed
      .map(({ id }) => id)
      .filter((id) => !sync.synced.has(id) && (startsOf(id).length || mayBeSent.has(id) || (Object.hasOwn(earlier, id) && (earlierSent.has(id) || (Array.isArray(earlierStarts[id]) && earlierStarts[id].length)))));
    // The starting copies: all of this tab's current ones (the copy it last
    // saved, and those sent since without an answer yet), and of those kept
    // earlier, before a later save, the first and the last few.
    const text = (copy) => JSON.stringify(copy);
    const starts = {};
    const fewer = {};
    for (const { id } of changed) {
      const now = startsOf(id);
      const seen = new Set(now.map(text));
      const before = (Object.hasOwn(earlier, id) && Array.isArray(earlierStarts[id]) ? earlierStarts[id] : []).filter((copy) => !seen.has(text(copy)) && seen.add(text(copy)));
      const copies = [...(before.length > 4 ? [before[0], ...before.slice(-3)] : before), ...now];
      if (!copies.length) continue;
      starts[id] = copies;
      fewer[id] = [now[0] ?? before[0]];
    }
    const fits = (record) => {
      try {
        localStorage.setItem(key, JSON.stringify(record));
        return true;
      } catch {
        return false;
      }
    };
    const putBack = () => {
      coach.conversations = conversations;
      try {
        if (storedCoach !== null && localStorage.getItem(coachKey) !== storedCoach) localStorage.setItem(coachKey, storedCoach);
      } catch {
        // Writing back what was there only takes back the room it freed; if even that fails, nothing else can be done.
      }
    };
    // Short of room: one starting copy for each idea, then none, and only
    // then do the oldest Coach conversations make room.
    const records = [{ ideas: changed, deleted, base, sent, starts }, { ideas: changed, deleted, base, sent, starts: fewer }, { ideas: changed, deleted, base, sent }];
    do {
      if (records.some(fits)) return { kept: count, lost: 0 };
    } while (dropOldestCoach());
    putBack();
    return { kept: 0, lost: count };
  }

  // Removes this account's oldest Coach conversation from this device, to make
  // room. False when there is none left to remove.
  function dropOldestCoach() {
    try {
      const stored = readCoach();
      if (!stored.conversations.length) return false;
      const oldest = stored.conversations[stored.conversations.length - 1];
      const conversations = stored.conversations.slice(0, -1);
      coach.conversations = coach.conversations.filter((c) => c.id !== oldest.id || c.id === coach.currentId);
      if (conversations.length) localStorage.setItem(COACH_STORE + account.id, JSON.stringify({ conversations, deleted: stored.deleted }));
      else localStorage.removeItem(COACH_STORE + account.id);
      return true;
    } catch {
      return false;
    }
  }

  // Whether two ideas hold the same data, whatever the order of their keys: the
  // database doesn't keep the order an idea's ratings, gates and notes were in.
  const sortedKeys = (key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)))
      : value;
  const sameContent = (a, b) => JSON.stringify(a, sortedKeys) === JSON.stringify(b, sortedKeys);

  // What a kept change saved as a copy of its own is called after.
  const KEPT_SUFFIX = ' (kept on this device)';

  // The id a kept change's copy is saved under: the same for the same kept
  // change, so two tabs restoring it at once make one copy (the second add is
  // refused as one already there, and settled as such). Four 32-bit FNV-1a
  // hashes of the text, shaped as a version-4 UUID.
  function copyId(text) {
    const words = [0x811c9dc5, 0x01000193, 0x5bd1e995, 0x27d4eb2f].map((seed) => {
      let h = seed >>> 0;
      for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
      return h.toString(16).padStart(8, '0');
    });
    const h = words.join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) & 3]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  // A record of kept changes as keepUnsaved writes it (or an older version of
  // the app did), each kept idea and starting copy read; null when it isn't
  // one (damaged, or left by a newer version of the app). Such a record is
  // left on the device as it is: the others are restored all the same.
  function readKept(raw) {
    let one;
    try {
      one = JSON.parse(raw);
    } catch {
      return null;
    }
    const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
    const idea = (value) => (isRecord(value) && typeof value.id === 'string' && value.id ? core.sanitizeIdea(value) : null);
    const ids = (list) => list === undefined || (Array.isArray(list) && list.every((id) => typeof id === 'string'));
    if (!isRecord(one) || !Array.isArray(one.ideas) || !ids(one.deleted) || !ids(one.sent)) return null;
    if (!(one.base === undefined || isRecord(one.base)) || !(one.starts === undefined || isRecord(one.starts))) return null;
    const ideas = one.ideas.map(idea);
    if (ideas.some((i) => !i)) return null;
    const starts = {};
    for (const [id, copies] of Object.entries(one.starts ?? {})) {
      if (!Array.isArray(copies)) return null;
      starts[id] = copies.map(idea);
      if (starts[id].some((i) => !i)) return null;
    }
    return { ideas, deleted: one.deleted ?? [], base: one.base, sent: new Set(one.sent ?? []), starts };
  }

  // Applies changes kept from an earlier sign-out to the ideas just loaded. A
  // kept change goes in whole when the account's copy is still one it started
  // from: the copy this tab last saved (`base`), or one it sent whose answer
  // never came (`starts`), which may have landed. When the account's copy has
  // changed elsewhere since (on another device, or by another tab's kept
  // change just applied), nothing is merged or guessed: the kept change is
  // saved as an idea of its own, named "… (kept on this device)", next to the
  // account's, for the person to compare and keep what they want. A copy
  // already there from an earlier sign-in isn't made again. A kept change to
  // an idea deleted elsewhere is left out (it stays deleted), and so is a kept
  // deletion of an idea edited elsewhere since (that edit stays). A new idea
  // the account doesn't have goes in; if its add may have landed before, it
  // may have been deleted elsewhere since, so it is counted (`returned`) for
  // the header to say so: it is never brought back without a word. A record
  // that can't be read is left on the device (`unreadable`), and if the
  // restore fails, nothing is applied and no record is forgotten (`failed`).
  // Returns how many ideas it changed, how many kept changes it left out, and
  // how many it saved as copies.
  function restoreUnsaved(ideas) {
    const result = { changed: 0, skipped: 0, copies: 0, returned: 0, unreadable: 0, failed: false };
    // Applied to a copy of the list, so a failure leaves the ideas as loaded.
    const out = ideas.slice();
    const copiedBefore = copiedFrom;
    copiedFrom = new Map(copiedFrom);
    readUnsaved = new Map();
    mayBeSent = new Set();
    let keys;
    try {
      keys = unsavedKeys();
    } catch {
      // Storage can't be read here: nothing kept can be found.
      return result;
    }
    try {
      // Every tab's kept changes together, each tab's copy of an idea kept.
      const kept = new Map();
      const gone = new Map();
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        const one = readKept(raw);
        if (!one) {
          result.unreadable++;
          continue;
        }
        // Read: forgotten once saved, unless its tab rewrites it meanwhile.
        readUnsaved.set(key, raw);
        // Changes kept before `base` was recorded go in as they are.
        const base = one.base || {};
        const baseOf = (id) => (Object.hasOwn(base, id) ? { base: base[id] } : {});
        const startsOf = (id) => (Object.hasOwn(one.starts, id) && one.starts[id].length ? { starts: one.starts[id] } : {});
        // Sent before without an answer: it may have landed.
        const sentOf = (id) => (one.sent.has(id) || Object.hasOwn(startsOf(id), 'starts') ? { sent: true } : {});
        for (const idea of one.ideas) {
          if (!kept.has(idea.id)) kept.set(idea.id, []);
          kept.get(idea.id).push({ idea, ...baseOf(idea.id), ...startsOf(idea.id), ...sentOf(idea.id) });
        }
        for (const id of one.deleted) if (!gone.has(id)) gone.set(id, baseOf(id));
      }
      const movedOn = (entry, copy) => Object.hasOwn(entry, 'base') && (copy ? copy.updatedAt : null) !== entry.base;
      // Whether the account's copy is one this kept change started from.
      const startedFrom = (entry, copy) => !movedOn(entry, copy) || (entry.starts ?? []).some((start) => sameContent(start, copy));
      const copies = [];
      for (const entries of kept.values()) {
        entries.sort((a, b) => Date.parse(a.idea.updatedAt) - Date.parse(b.idea.updatedAt));
        const at = out.findIndex((i) => i.id === entries[0].idea.id);
        const copy = out[at];
        let idea = copy;
        for (const entry of entries) {
          // Already there (a save that landed after the sign-out, or another
          // tab's same change): nothing to apply.
          if (idea && sameContent(idea, entry.idea)) continue;
          if (!idea) {
            // Deleted elsewhere after it was saved: it stays deleted.
            if (movedOn(entry, idea)) result.skipped++;
            // An idea the account doesn't have: it goes in.
            else idea = entry.idea;
            continue;
          }
          if (idea === copy && startedFrom(entry, copy)) idea = entry.idea;
          else copies.push(entry.idea);
        }
        if (idea === copy) continue;
        if (at === -1) out.unshift(idea);
        else out[at] = idea;
        // Brought in though any tab's add of it may have landed before: it may
        // have been deleted elsewhere since, so the header says so.
        if (at === -1 && entries.some((entry) => entry.sent)) {
          mayBeSent.add(idea.id);
          result.returned++;
        }
        result.changed++;
      }
      // Everything but the id and times, to tell whether a copy is there already.
      const body = (idea) => ({ ...idea, id: '', createdAt: '', updatedAt: '' });
      for (const { id, createdAt, updatedAt, example, ...fields } of copies) {
        const name = [...fields.name].slice(0, core.TEXT_LIMITS.name - KEPT_SUFFIX.length).join('').trim() + KEPT_SUFFIX;
        // Its id and times come from the kept change, the same in every tab.
        const twin = core.sanitizeIdea({ ...fields, name, id: copyId(JSON.stringify([id, updatedAt, fields], sortedKeys)), createdAt: updatedAt, updatedAt });
        if (out.some((i) => i.id === twin.id || sameContent(body(i), body(twin)))) continue;
        out.unshift(twin);
        copiedFrom.set(twin.id, id);
        result.copies++;
        result.changed++;
      }
      for (const [id, entry] of gone) {
        const at = out.findIndex((i) => i.id === id);
        if (at === -1) continue;
        // Edited on another device after it was deleted here: that edit stays.
        if (movedOn(entry, out[at])) {
          result.skipped++;
          continue;
        }
        out.splice(at, 1);
        result.changed++;
      }
      ideas.splice(0, ideas.length, ...out);
      return result;
    } catch {
      // Nothing applied, and nothing read is forgotten: the kept changes stay
      // on the device for the next sign-in.
      copiedFrom = copiedBefore;
      readUnsaved = new Map();
      mayBeSent = new Set();
      return { changed: 0, skipped: 0, copies: 0, returned: 0, unreadable: result.unreadable, failed: true };
    }
  }

  // Some ideas are saved, others not yet (one keeps failing, or is refused):
  // the saved ones' kept changes go, from this tab's own record and from those
  // it read at sign-in (unless their tab has rewritten them since), so a change
  // already saved isn't saved again at the next sign-in as a copy next to a
  // later edit made elsewhere.
  function forgetSaved() {
    try {
      if (!account) return;
      const current = snapshot(state.ideas);
      const saved = (id) => (movedTo.has(id) ? saved(movedTo.get(id)) : sync.synced.has(id) && sync.synced.get(id) === current.get(id) && !sync.refused.has(id));
      // Deleted here, and the delete went through.
      const gone = (id) => !sync.synced.has(id) && !current.has(id);
      // A copy saved, or deleted here, no longer needs the kept change it came from.
      for (const id of [...copiedFrom.keys()]) if (saved(id) || gone(id)) copiedFrom.delete(id);
      const copying = new Set(copiedFrom.values());
      const own = ownUnsavedKey();
      for (const key of new Set([own, ...readUnsaved.keys()])) {
        const raw = localStorage.getItem(key);
        if (raw === null || (key !== own && raw !== readUnsaved.get(key))) continue;
        const one = JSON.parse(raw);
        if (!one || !Array.isArray(one.ideas)) continue;
        const ideas = one.ideas.filter((idea) => !(idea && saved(idea.id) && !copying.has(idea.id)));
        const deleted = (Array.isArray(one.deleted) ? one.deleted : []).filter((id) => !gone(id));
        if (ideas.length === one.ideas.length && deleted.length === (one.deleted?.length ?? 0)) continue;
        const left = new Set([...ideas.map((idea) => idea?.id), ...deleted]);
        const only = (map) => (map && typeof map === 'object' ? Object.fromEntries(Object.entries(map).filter(([id]) => left.has(id))) : map);
        const next = left.size ? JSON.stringify({ ...one, ideas, deleted, base: only(one.base), starts: only(one.starts) }) : null;
        if (next === null) localStorage.removeItem(key);
        else localStorage.setItem(key, next);
        if (!readUnsaved.has(key)) continue;
        if (next === null) readUnsaved.delete(key);
        else readUnsaved.set(key, next);
      }
    } catch {
      // Storage unavailable, or a record that can't be read: left as it is.
    }
  }

  // This tab's changes are all saved: its kept changes go, and so do those it
  // read at sign-in (now saved too), unless their tab has rewritten them since.
  function forgetUnsaved() {
    try {
      if (!account) return;
      localStorage.removeItem(ownUnsavedKey());
      for (const [key, raw] of readUnsaved) if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
      readUnsaved = new Map();
    } catch {
      // Nothing kept, or storage is unavailable.
    }
  }

  // Another device or tab may have changed the ideas since they were loaded.
  // While nothing here is waiting to be saved, they are checked again when this
  // tab comes back into view: first only each idea's last-changed time, and
  // every idea in full only when something differs.
  let refreshing = false;
  const settled = () =>
    signedIn && !sync.busy && sync.timer === null && !sync.again && !sync.refused.size && !changesPending() && !typedTooLong();
  // The database holds exactly the ideas this tab has, each at the version
  // this tab last saw. Each row's version changes with every write, wherever
  // it was made; versions are compared as the database wrote them.
  const unchanged = (versions) =>
    versions.size === state.ideas.length && state.ideas.every((idea) => versions.has(idea.id) && versions.get(idea.id) === sync.versions.get(idea.id));

  async function refreshIdeas() {
    if (refreshing || !settled()) return;
    refreshing = true;
    const epoch = authEpoch;
    // Changed here meanwhile, even if already saved: what was read is older
    // than this tab, so it is dropped and the next return checks again.
    const start = edits;
    const stale = () => epoch !== authEpoch || !settled() || edits !== start;
    try {
      const versions = await cloud.loadVersions();
      if (stale() || unchanged(versions)) return;
      const stored = await cloud.loadIdeas();
      const loaded = stored.ideas.map(core.sanitizeIdea).filter(Boolean);
      // Signed out, or edited here meanwhile: try again next time.
      if (stale()) return;
      const fresh = snapshot(loaded);
      const mine = snapshot(state.ideas.map(core.sanitizeIdea));
      const same = (id) => fresh.get(id) === mine.get(id);
      // Nothing to show, but the versions read are the account's now: with
      // the old ones kept, every return would read every idea again, and the
      // next save would be taken for one meeting a change made elsewhere.
      if (fresh.size === mine.size && [...fresh.keys()].every(same)) {
        sync.versions = stored.versions;
        return;
      }
      // A removed invite hides every idea rather than refusing the read, which
      // would look as if they were all deleted elsewhere. Check before applying.
      if ([...mine.keys()].some((id) => !fresh.has(id)) && (await cloud.accessRemoved())) {
        if (epoch === authEpoch && signedIn) await leaveRemovedAccess('Your access to this app was removed.');
        return;
      }
      if (stale()) return;
      const editorChanged = !same(state.selectedId);
      state.ideas = loaded;
      sync.synced = fresh;
      sync.versions = stored.versions;
      stopOrphanDrafts();
      renderFilters();
      if (!selected()) {
        state.selectedId = isNarrow() ? null : visibleIdeas()[0]?.id ?? null;
        els.workbench.classList.remove('show-editor');
      }
      keepFocus(() => {
        renderList();
        if (editorChanged) renderEditor();
        if (state.view === 'matrix') renderMatrix();
      });
    } catch {
      // Offline or signed out; the next refresh tries again.
    } finally {
      refreshing = false;
    }
  }

  // Leaving the page or switching to another app: save what is waiting now,
  // since a phone may close the page without asking. What isn't saved yet is
  // kept on this device too, in case the save fails (offline) and the phone
  // then discards the page.
  function saveNow() {
    if (!signedIn) return;
    const pending = changesPending();
    // The save goes out first, so what it sends is kept as possibly landed
    // (`sync.sending`): a new idea it adds may then be deleted elsewhere.
    if (sync.timer !== null) runSync();
    if (pending) keepUnsaved();
  }

  window.addEventListener('beforeunload', (e) => {
    if (hasUnsaved() || typedTooLong()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function showApp(show) {
    $('#sidebar').hidden = !show;
    $('.topbar').hidden = !show;
    $('main').hidden = !show;
    $('#account').hidden = !show;
    $('#auth-screen').hidden = show;
  }

  function showSignIn(message, { canSignIn = true } = {}) {
    signedIn = false;
    clearTimeout(sync.timer);
    Object.assign(sync, { synced: new Map(), versions: new Map(), unsure: new Map(), sending: new Map(), refused: new Map(), timer: null, again: false, failures: 0, note: '' });
    copiedFrom = new Map();
    state.ideas = [];
    state.selectedId = null;
    forgetLanding();
    forgetLandscape();
    forgetCoach();
    closeDataDialogs();
    showApp(false);
    els.banner.hidden = true;
    const note = $('#auth-message');
    note.textContent = message || '';
    note.hidden = !message;
    $('#sign-in').disabled = !canSignIn;
  }

  // Every sign-out bumps this, so work started before it (loading ideas,
  // checking for changes) is dropped when it finishes.
  let authEpoch = 0;
  let loading = false;
  // Set while this tab signs out on purpose: what the sign-in screen then says.
  let ownSignOut = null;

  async function leaveRemovedAccess(what) {
    sync.stopped = true;
    const message = `${what} Ask the owner if this is a mistake.`;
    if (!(await signOutHere(message))) showSignIn(message);
  }

  // Signs this browser out and shows the sign-in screen with `message`.
  // Returns false if the sign-out didn't happen (for example, offline).
  async function signOutHere(message = '') {
    ownSignOut = { message };
    const everywhere = await cloud.signOut().catch(() => true);
    const done = ownSignOut === null;
    ownSignOut = null;
    // Sign out asked for by the person: say if it only reached this browser.
    if (done && !everywhere && !message) {
      showSignIn("Signed out of this browser, but your other devices couldn't be signed out just now. To sign them out, sign in and sign out again.");
    }
    return done;
  }

  // `other` is the email of another account that signed in in another tab,
  // which replaces this tab's sign-in; null for an ordinary sign-out.
  function onSignedOut(other) {
    authEpoch++;
    if (ownSignOut) {
      const { message } = ownSignOut;
      ownSignOut = null;
      keepUnsaved();
      showSignIn(message);
    } else if (signedIn) {
      const { kept, lost } = keepUnsaved();
      showSignIn(
        (other
          ? `${other} was signed in in another tab, so this tab was signed out.`
          : 'You were signed out, in another tab or because your sign-in ended.') +
          (kept
            ? ` Unsaved changes to ${kept} idea${kept === 1 ? ' are' : 's are'} kept on this device and will be saved when you sign in again.`
            : '') +
          (lost
            ? ` Unsaved changes to ${lost} idea${lost === 1 ? '' : 's'} could not be kept on this device, because its storage is full.`
            : '')
      );
    } else if (loading) {
      showSignIn(other ? `${other} was signed in in another tab. Sign in again to continue.` : 'You were signed out. Sign in again to continue.');
    }
  }

  async function enterAccount(session) {
    const epoch = authEpoch;
    account = { id: session.user.id, email: session.user.email };
    // Before the first request, so nothing goes out as another account.
    cloud.bindAccount(session.user.id);
    loading = true;
    let restored = { changed: 0, skipped: 0, copies: 0, returned: 0, unreadable: 0, failed: false };
    try {
      const invited = await cloud.isInvited();
      if (epoch !== authEpoch) return;
      if (!invited) {
        // Either reason (invited_account in supabase/schema.sql): the owner can check both.
        const message = `${session.user.email} can't use this app: it is not on the invite list, or the account also signs in some other way than Google. Ask the owner to check.`;
        if (!(await signOutHere(message))) showSignIn(message);
        return;
      }
      const stored = await cloud.loadIdeas();
      const ideas = stored.ideas.map(core.sanitizeIdea).filter(Boolean);
      if (epoch !== authEpoch) return;
      sync.synced = snapshot(ideas);
      sync.versions = stored.versions;
      restored = restoreUnsaved(ideas);
      // Nothing left to save from it, so it isn't applied again next time.
      // After a failed restore, everything kept stays for the next sign-in.
      if (!restored.changed && !restored.failed) forgetUnsaved();
      const notes = [];
      if (restored.copies) {
        const n = restored.copies;
        notes.push(`${n} change${n === 1 ? '' : 's'} kept on this device ${n === 1 ? 'was' : 'were'} saved as ${n === 1 ? 'a copy' : 'copies'} named “…${KEPT_SUFFIX}”, because ${n === 1 ? 'that idea was' : 'those ideas were'} changed elsewhere since.`);
      }
      if (restored.skipped) {
        const n = restored.skipped;
        notes.push(`${n} change${n === 1 ? '' : 's'} kept on this device ${n === 1 ? 'was' : 'were'} left out, because ${n === 1 ? 'that idea was' : 'those ideas were'} changed or deleted on another device since.`);
      }
      if (restored.returned) {
        const n = restored.returned;
        notes.push(`${n} idea${n === 1 ? '' : 's'} kept on this device ${n === 1 ? 'was' : 'were'} added back, though ${n === 1 ? 'it' : 'they'} may have been deleted on another device since. If so, delete ${n === 1 ? 'it' : 'them'} again.`);
      }
      if (restored.failed) notes.push('Changes kept on this device could not be restored. They are still on this device, for the next sign-in.');
      else if (restored.unreadable) notes.push('Some changes kept on this device could not be read, so they were left there as they are.');
      if (notes.length) sync.note = notes.join(' ');
      state.ideas = ideas;
      // A copy made from a kept change is kept on the device at once: its
      // source's kept change is forgotten once that idea counts as saved.
      if (restored.copies) keepUnsaved();
      sync.stopped = false;
    } catch (err) {
      if (epoch === authEpoch) showSignIn(`Your ideas could not be loaded (${err.message}). Reload the page to try again.`);
      return;
    } finally {
      loading = false;
    }
    signedIn = true;
    $('#account-email').textContent = session.user.email;
    // With kept changes to save, a note waits for that save to finish.
    if (restored.changed) setSyncStatus('saved');
    else showSaved();
    showApp(true);
    state.selectedId = isNarrow() ? null : core.sortIdeas(state.ideas, state.sort)[0]?.id ?? null;
    renderAll();
    loadLandingPages();
    loadLandscape();
    loadCoach();
    // Changes kept from an earlier sign-out go to the account now.
    if (restored.changed) scheduleSync();
  }

  $('#sign-in').addEventListener('click', async () => {
    $('#sign-in').disabled = true;
    try {
      const { error } = await cloud.signIn();
      if (error) showSignIn(error.message);
    } catch (err) {
      showSignIn(`Sign-in could not start (${err.message}). Reload the page to try again.`);
    }
  });

  $('#sign-out').addEventListener('click', async () => {
    // Text typed past a field's limit isn't saved anywhere, so signing out would lose it.
    const tooLong = document.querySelector('[data-unsaved]');
    if (tooLong) {
      const line = core.CRITERIA.find((c) => c.id === tooLong.dataset.note);
      const field = line ? `note on “${line.name}”` : { 'idea-name': 'name', 'idea-tags': 'tags' }[tooLong.id] || 'notes';
      setSyncStatus('error');
      $('#sync-status').textContent = `Shorten the ${field}: it's too long to save, so you are still signed in.`;
      tooLong.focus();
      return;
    }
    const button = $('#sign-out');
    button.disabled = true;
    const saved = await flushSync();
    button.disabled = false;
    // Signed out meanwhile, in another tab: that screen and its message stay.
    if (!signedIn) return;
    if (!saved) {
      // Signing out would lose the changes, so stay signed in and say why.
      setSyncStatus('error');
      $('#sync-status').textContent = sync.refused.size
        ? `${refusedText()}, so you are still signed in. Edit or delete it, then sign out.`
        : 'Not saved yet, so you are still signed in. Check your connection and try again.';
      return;
    }
    if (!(await signOutHere())) {
      setSyncStatus('error');
      $('#sync-status').textContent = "Couldn't sign out. Check your connection and try again.";
    }
  });

  async function startCloud() {
    loadPrefs();
    showApp(false);
    $('#sign-in').disabled = true;
    const note = $('#auth-message');
    note.textContent = 'Checking sign-in…';
    note.hidden = false;
    let result;
    try {
      result = await cloud.init();
    } catch (err) {
      // Without the sign-in service the button can't work; the message says to reload.
      showSignIn(err.message, { canSignIn: false });
      return;
    }
    cloud.onSignOut(onSignedOut);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshIdeas();
        refreshLandingPages();
        refreshLandscape();
      } else saveNow();
    });
    window.addEventListener('focus', () => {
      refreshIdeas();
      refreshLandingPages();
      refreshLandscape();
    });
    window.addEventListener('pagehide', saveNow);
    window.addEventListener('online', saveNow);
    if (result.session) await enterAccount(result.session);
    else showSignIn(result.error);
  }

  function startLocal() {
    const stored = load();
    state.ideas = stored ?? exampleIdeas();
    if (!stored) save();
    if (!isNarrow()) state.selectedId = core.sortIdeas(state.ideas, state.sort)[0]?.id ?? null;
    renderAll();
  }

  // ---------- Start ----------

  syncImportLabel();
  if (cloud.enabled) startCloud();
  else startLocal();
})();

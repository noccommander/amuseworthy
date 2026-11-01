// Coach: the app's chatbot, which scores ideas and works them toward Buildable
// with the model and API key the person chooses. What the model is told, the tools it
// can call and what they answer, and the chat's text as safe HTML. No DOM
// access here, so the same file runs in the browser (window.IdeaCoach), under
// `node --test`, and in the Worker (worker.mjs takes the tools from it).
//
// The model never adds up points itself: its tools run here, in the browser,
// on the app's own scoring (src/core.js), so every figure it quotes is the
// app's. It can't change ideas either: propose_idea shows the person a card,
// and only they save it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.IdeaCoach = factory(root.IdeaCore);
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const GOLD = core.SCORECARD_IDS;
  const GATES = core.GATE_IDS;
  const STAR_IDS = core.CRITERIA.filter((c) => !core.isGate(c.id)).map((c) => c.id);
  const CORE_IDS = STAR_IDS.filter((id) => !GOLD.includes(id));
  const nameOf = (id) => core.CRITERIA.find((c) => c.id === id).name.replace(/^Gate \d \(pass\/fail\): /, '');

  // ---------- The line guides ----------

  // Every gate and star line, word for word as the app shows them
  // (src/descriptions.js), in the app's order, so Coach rates against the
  // same words the person reads.
  function buildGuides(descriptions) {
    const { CRITERIA: GUIDES, NOTES } = descriptions;
    const out = [];
    const p = (...lines) => out.push(...lines);

    function entry(id, heading, weights) {
      const d = GUIDES[id];
      p(heading, '');
      if (weights) p(`Weight: Income ×${core.GOALS.income.weights[id]}, Asset ×${core.GOALS.asset.weights[id]}.`, '');
      if (d.summary) p(`**Question:** ${d.summary}`, '');
      for (const para of d.details || []) p(para, '');
      if (d.scale) p(`**${d.scaleLabel || 'How many stars'}:**`, '', ...d.scale.map((line) => `- ${line}`), '');
      if (d.warning) p(`**Watch out:** ${d.warning}`, '');
      if (d.note) p(`See also: [${NOTES[d.note].title}](#note-productmarket-fit).`, '');
    }

    p('# Line guides', '');
    p("Every gate and star line of Amuseworthy's scorecard, copied from the app (`src/descriptions.js`), in the order the app shows them. Rate against these words, not a general impression: the star guides are specific (for example, Lifetime gross profit to acquisition cost needs 10 to 1 for 5 stars).", '');
    p('Gold-line guides describe 5, 3 and 1 stars. Give 4 or 2 stars when the idea falls between them. Core-metric guides cover every star count.', '');
    p('## Contents', '');
    p('- [Gates](#gates): ' + GATES.map((id) => `\`${id}\``).join(', '));
    p('- [Gold lines](#gold-lines): ' + GOLD.map((id) => `\`${id}\``).join(', '));
    p('- [Core metrics](#core-metrics): ' + CORE_IDS.map((id) => `\`${id}\``).join(', '));
    p("- [Note: product/market fit](#note-productmarket-fit) (part of Gate 4's guide)", '');
    p('## Gates', '');
    p("Answer each Pass or Fail. A gate on Fail means no verdict (\"Gate failed\"). Gates don't change Average Stars.", '');
    GATES.forEach((id, i) => entry(id, `### Gate ${i + 1}: ${nameOf(id)} (\`${id}\`)`, false));
    p('## Gold lines', '');
    p('These 12 decide the verdict: each earns stars minus one in points (0 to 4), times its weight for the goal.', '');
    for (const id of GOLD) entry(id, `### ${nameOf(id)} (\`${id}\`)`, true);
    p('## Core metrics', '');
    p("From the original Ideation Calculator sheet. They count toward Average Stars (×1 by default) but not the verdict. Several scales run against intuition: read them closely.", '');
    for (const id of CORE_IDS) entry(id, `### ${nameOf(id)} (\`${id}\`)`, false);
    p('## Note: product/market fit', '');
    for (const s of NOTES['product-market-fit'].sections) p(`**${s.title}**`, '', ...s.items.map((it) => `- ${it}`), '');
    return out.join('\n').replace(/\n+$/, '\n');
  }

  // ---------- What the model is told ----------

  function frameworkTables() {
    const { income, asset } = core.GOALS;
    const most = (goal) => GOLD.reduce((sum, id) => sum + 4 * goal.weights[id], 0);
    const rows = GOLD.map((id) => `| ${nameOf(id)} | ${income.weights[id]} | ${asset.weights[id]} |`);
    const band = (goal, level) => {
      if (level === 0) return `${goal.bands[0]}+`;
      if (level === goal.bands.length) return `under ${goal.bands[level - 1]}`;
      return `${goal.bands[level]}–${goal.bands[level - 1] - 1}`;
    };
    const verdicts = core.VERDICTS.map((label, level) => `| ${label} | ${band(income, level)} | ${band(asset, level)} |`);
    return [
      '| Gold line | Income | Asset |',
      '|---|---:|---:|',
      ...rows,
      `| **Most points possible** | **${most(income)}** | **${most(asset)}** |`,
      '',
      '| Verdict | Income | Asset |',
      '|---|---|---|',
      ...verdicts,
    ].join('\n');
  }

  // The framework, the workflow and the rounds Coach follows, with the app's
  // tools for every figure.
  function buildSystemPrompt(descriptions) {
    return `You are Coach, the chatbot inside Amuseworthy, a web app where a founder scores business ideas on the same questions every time. You score ideas with the app's own line guides and the app's own arithmetic, then work with the founder in rounds of questions until the idea is Buildable, or until it is clear it won't be and they should change it or drop it. You can also compare their saved ideas and invent new ones from them.

## The framework in one minute

1. **Goal: Income or Asset.** Income is a business that pays you while you keep working in it. Asset is a company someone else could buy one day. The goal sets how much each gold line counts.
2. **Four gates, Pass or Fail.** State the goal; you have done the work; one product, one avatar, one channel; the industry is not shrinking. Any Fail means no verdict ("Gate failed"), however well the idea scores.
3. **21 star lines, 1 to 5 stars** (1 is poor, 5 is excellent): **12 gold lines** decide the verdict (each earns stars − 1 points, 0 to 4, times its weight for the goal); **9 core metrics** count toward Average Stars only.
4. **Verdict:** needs a goal, all four gates on Pass and all 12 gold lines rated.

${frameworkTables()}

**Average Stars** is the weighted mean of every rated line that counts: gold lines at the goal's weight, core metrics at ×1. A line can be switched off ("Counts" off) or marked as a deal-breaker ("Fail verdict manually"), which fails the idea like a failed gate. Neither changes the verdict table above.

## Your tools

- **list_ideas**: the founder's saved ideas, each with its verdict, points and Average Stars.
- **get_idea**: one saved idea in full: gates, every line's stars and note, the idea's notes.
- **score_idea**: the app's scoring for a saved idea or one you describe, and what a change would do ("what if"). It gives the verdict, points, the points the next verdict needs, Average Stars, the range while gates are open or gold lines unrated, both goals when none is chosen, and the biggest gains per star.
- **propose_idea**: shows the founder a card with an idea to save, or changes to one of their saved ideas, with the score before and after. Nothing is saved until they click the card's button.

**Never add up points yourself.** The bands are tight: 144 and 145 points are different verdicts for an Income idea. Call score_idea for the scorecard and for every "+N points" you quote, with \`set\`, \`gates\` and \`goal\` for what-ifs. You may call several tools in one turn.

## Workflow

### 1. Understand the idea
Read everything the founder gave you: the pitch, notes, numbers, a saved idea. Pin down, as far as the material allows: who the customer is, what exactly is sold and at what price, how the first customers would be reached, what delivery costs, how often a customer pays, and what the founder has done before in this market.

Don't interview them before giving anything back. A first scorecard with its assumptions marked is more useful than twenty questions, because it shows which unknowns actually matter. Ask afterwards, and only about what would change the result. For a brand-new idea with only a sentence or two, ask at most three short questions first (who buys, what they pay for, what the founder has done in this market), then score.

### 2. Settle the goal
Use the goal if the founder stated it, or if it is plain from what they said ("I want to sell it in five years" is Asset; "I need it to replace my salary" is Income). If it isn't clear, score under both goals (score_idea shows both when no goal is set) and show both verdicts. Gate 1 stays open until they choose: an idea that "works either way" usually serves neither.

### 3. Rate against the guides
The line guides are below. Rate against their words every time, not a general impression. They are concrete and sometimes strict: Lifetime gross profit to acquisition cost needs about 10 to 1 for 5 stars, and Stickiness needs you to name what happens at day 30, day 90 and month six.

### 4. Answer the gates
Give each gate Pass, Fail or open, with a one-line reason.
- **Gate 2 (you have done the work)** is about the founder, not the idea. Never assume it passes. If they haven't said what they have done in this market, leave it open and ask.
- **Gate 3** fails when the idea needs two customer types, two offers or "we'll see which channel works". If the pitch lists several, say which single combination you are scoring, or fail it.
- **Gate 4:** a flat industry passes. Market tailwind then scores how much the market helps.
An open gate is not a Fail: score_idea reports the provisional verdict, so the founder sees what is at stake.

### 5. Rate all 21 lines
For each line give the stars, a short reason that ties a fact about the idea to the guide's wording, and where the fact came from: **stated** (the founder said it), **inferred** (it follows from what they said or from the category) or **assumed** (a reasonable guess; say what would change it).
- Rate the idea as it stands, not the best case once everything goes right.
- Gold-line guides describe 5, 3 and 1 stars. Use 4 and 2 for in-between cases.
- The framework is demanding by design. Most real ideas land on Fix one or two lines or Kill or redesign at first, and that is useful information, not failure. Don't inflate stars to be encouraging or deflate them to look rigorous.
- Several core-metric scales run against intuition: on Entry Into The Marketplace, *harder* to launch earns *more* stars; on Control and Third-Party Dependency, 5 stars means *no* single company can shut you down; Collectable is 1 star for most services and software, and that is normal.
- Rate each idea against the guides, not against the founder's other ideas.

### 6. Report
Write for a founder, not an analyst: plain words, short reasons, no formulas. Use this layout:

# <Idea name>: <verdict, or "Gate failed", or "No verdict yet">
**Goal:** Income · **Verdict:** Fix one or two lines, 104 of 164 points (Buildable starts at 120) · **Average Stars:** 3.12 (21 of 21 rated)
<Two or three sentences: the honest bottom line and the main reason for it.>
## Gates
| Gate | Answer | Why |
## Gold lines (decide the verdict)
| Line | Stars | Weight | Points | Why | Basis |
## Core metrics (count toward Average Stars only)
| Line | Stars | Why | Basis |
## What would move the verdict
<How many points the next verdict needs, and which gold lines can realistically supply them, biggest gain per star first.>
## Round 1
<The first round of questions, as below.>

For several ideas, put a ranking table first (idea, goal, verdict and points, Average Stars), then a short scorecard for each. The verdict says whether to build; Average Stars ranks ideas with the same verdict. If two ideas have different goals, say so: their points are on different scales.

### 7. Improve the idea in rounds
You question the founder about the decisions behind the weak lines until every star rests on something they have decided or a fact you have checked. Then you agree together on the version worth building, or agree that this idea won't get there. (The method is adapted from Matt Pocock's *grilling* skill, MIT licence.)

**The decision tree.** The goal comes first: it sets every weight. Gate 2 (what they have done in this market) and Gate 3 (the one customer, one offer, one channel) come next: until the customer and the offer are fixed, questions about the guarantee or the price have nothing to hang on. Offer decisions hang off those: what result is promised and how fast (Value equation); what happens if it isn't reached (Offer you can guarantee); how and when they pay, with what upsell (30-day cash, Lifetime gross profit to acquisition cost); how the result gets recorded and turned into the next customer (Proof loop); who delivers and sells (You can leave it, Operational drag); how the first customers arrive (First customers without ads).

**Each round asks the whole frontier**: every decision whose prerequisites are already settled. A question whose answer depends on another question still open in the same round waits for a later round. If the goal is still open, ask it on its own with Gate 2. Within a round, order questions by points at stake, highest first. Ask about lines worth ×3 or more; settle ×1 lines and core metrics from facts and your own judgement, unless the founder cares about them.

Write each question like this:

❓ **Q1 – Guarantee** (Offer you can guarantee, ×5 · now 1 star): Will you attach a consequence you control, such as "your books closed and a summary in your inbox by the 10th, or that month is free"?

➡️ Yes, with that wording. **+10 points: 83 → 93, Kill or redesign → Fix one or two lines.** 5 stars would need "we work free until it's right" plus bonuses; worth it only once you've seen how often you miss the 10th.

---

- **Word each question so that "yes" accepts your recommended answer**, so the founder can answer a round with "1 yes, 2 yes, 3 no: I bill after the close".
- **Recommend what is right for the business, not what scores highest.** A guarantee they can't keep, or a price they won't charge, is a worse business with a better score.
- **Quote the points from score_idea**, with the recommended answer as a what-if.

**Facts are your job; decisions are theirs.** Don't ask the founder what you can answer yourself: whether the industry is growing, who the incumbents are and what they charge, typical margins and churn, what guarantees competitors offer. You have no web access: answer from your own knowledge and say when a fact is from memory and may be out of date. Only the founder can answer their decisions (price, guarantee, who they'll serve, whether they'll do the work) and facts about them (experience, numbers, who they know).

**After each round:** apply the answers ("yes" means your recommended answer; anything else, rate their answer against the guide as it is, and a "no" stays a no). Re-rate every line the answers touch, including knock-on effects. Call score_idea on the new version and open your reply with a short versions table (v1 → v2 → v3, what each change was worth). Then ask the next round. Don't ask again about anything already settled.

**When to stop:**
- **The frontier is empty:** every gate answered, every gold line resting on a decision or a checked fact. Summarise the agreed version: verdict and points, the decisions as a to-do list, and the cheapest test to run first. Ask the founder to confirm it's the version they're going with, and once they confirm, call propose_idea.
- **It can't get there:** a gate fails that only time can fix, or the realistic gains can't reach the next verdict. Say so plainly and recommend the redesign that could work, the experience to get first, or a different idea closer to what they have done. Don't keep polishing an idea the framework says to kill.
- **They want to stop:** the same summary for wherever they've got to, and offer to save it.

## Saving with propose_idea
- Call it only when the founder has confirmed, or asks to save. It shows a card; the founder clicks **Save as new idea** or **Apply to this idea**, or leaves it. You'll hear what they chose in their next message.
- **mode "new"** for an idea that isn't saved yet (a new idea, or one you invented); **mode "update"** with the saved idea's \`id\` to change it. For an update, send only what changes, plus \`change\`: one line saying what this version changed.
- Put each line's reason in \`notes\` (line id → text, at most 1,000 characters each) and the idea's own description in \`ideaNotes\` (what it is, who it is for, why now; at most 2,000 characters). The name is at most 120 characters, and tags at most 200 characters in all.
- The founder's account holds up to ${core.MAX_IDEAS} ideas.

## Comparing ideas and inventing new ones
When asked which idea to pursue: call list_ideas, then get_idea for the contenders. Rank by verdict, then Average Stars; say what would change the recommendation. Round 1 asks the decisions that pick the winner, usually the goal and Gate 2 for each.

When asked for new ideas: read their saved ideas first. Look for what keeps scoring well (their experience, the customers they can reach, the delivery they're good at) and the lines that keep failing. Invent ideas that reuse their strengths and design around those failures: one product, one customer, one channel each. Give each a name, a two-sentence pitch and why it suits them, then score the most promising with score_idea (describe it with \`idea\`) and grill it like any other. Ask before inventing if you don't know what they want (more income soon, or an asset to sell).

## Style
Plain, direct, friendly. Use Markdown: headings, **bold**, lists, tables and --- between questions. No links, images or HTML. Keep replies as short as the step allows: the report and the rounds are the long parts. Answer in the language the founder writes in.

${buildGuides(descriptions)}`;
  }

  // ---------- Tools ----------

  // Plain JSON Schema that every provider takes (no oneOf, no
  // additionalProperties maps): one property per line, so the model sees the
  // ids it may use.
  const starProps = Object.fromEntries(STAR_IDS.map((id) => [id, { type: 'integer', description: `${nameOf(id)}: 1 to 5 stars` }]));
  const gateProps = Object.fromEntries(GATES.map((id) => [id, { type: 'string', enum: ['pass', 'fail', 'open'], description: nameOf(id) }]));
  const noteProps = Object.fromEntries(STAR_IDS.concat(GATES).map((id) => [id, { type: 'string', description: `Why: ${nameOf(id)}` }]));
  const goalProp = { type: 'string', enum: ['income', 'asset', 'none'], description: 'income, asset, or none (no goal chosen)' };
  const ideaProp = {
    type: 'object',
    description: "An idea that isn't saved, described in full: its name, goal, gates and stars. Lines left out are unrated, gates left out are open.",
    properties: { name: { type: 'string' }, goal: goalProp, gates: { type: 'object', properties: gateProps }, ratings: { type: 'object', properties: starProps } },
  };

  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'list_ideas',
        description: "The founder's saved ideas: id, name, goal, status, tags, the start of the notes, the verdict and points, and Average Stars.",
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_idea',
        description: 'One saved idea in full: name, goal, status, tags, notes, every gate, every line with its stars and note, any lines switched off, reweighted or failed by hand, and its score.',
        parameters: { type: 'object', properties: { id: { type: 'string', description: 'The idea id from list_ideas' } }, required: ['id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'score_idea',
        description:
          "The app's scoring for a saved idea (id) or one you describe (idea), or a saved idea with your changes on top (both). With set, gates or goal it is a what-if: the score before and after the change. Returns the verdict, points, the next verdict up and the points it needs, Average Stars, the range while gates are open or gold lines unrated, both goals when none is chosen, and the gold lines with the biggest gain per star.",
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'A saved idea id' },
            idea: ideaProp,
            set: { type: 'object', description: 'What if: lines set to these stars', properties: starProps },
            gates: { type: 'object', description: 'What if: gates set to pass, fail or open', properties: gateProps },
            goal: goalProp,
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_idea',
        description:
          'Shows the founder a card to save a new idea (mode "new") or change a saved one (mode "update", with its id), with the score before and after. Nothing is saved until they click. Call it only once they have confirmed the version, or asked to save.',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['new', 'update'] },
            id: { type: 'string', description: 'For mode "update": the saved idea id' },
            name: { type: 'string', description: 'At most 120 characters' },
            goal: goalProp,
            status: { type: 'string', enum: core.STATUSES },
            tags: { type: 'array', items: { type: 'string' }, description: 'At most 200 characters in all' },
            ideaNotes: { type: 'string', description: 'What the idea is, who it is for, why now. At most 2,000 characters' },
            gates: { type: 'object', properties: gateProps },
            ratings: { type: 'object', properties: starProps },
            notes: { type: 'object', description: "Each line's reason, by line id. At most 1,000 characters each", properties: noteProps },
            change: { type: 'string', description: 'One line: what this version changed' },
          },
          required: ['mode', 'change'],
        },
      },
    },
  ];
  const TOOL_NAMES = TOOLS.map((t) => t.function.name);
  // The most tool calls one answer may make (comparing every idea, say). The
  // app refuses an answer with more, and the Worker refuses a conversation
  // holding one, so the two agree.
  const MAX_TOOL_CALLS = 64;

  // ---------- What the Worker takes back of an earlier answer ----------
  // Shared by the Worker (readChat in worker.mjs), which refuses a
  // conversation holding anything else, and the app (coachTurn in
  // src/app.js), which keeps only what the Worker will take, so a
  // conversation the app accepted can always be sent again.

  // The longest text a conversation's message may hold (its whole size limit).
  const MAX_CHAT_BYTES = 1024 * 1024;
  // Providers name tool calls in their own ways (call_…, toolu_…, function-call-…).
  const CALL_ID = /^[\w.:-]{1,128}$/;

  // ---------- Scoring, as the app reports it ----------

  const band = (goal, score) => {
    const level = core.GOALS[goal].bands.findIndex((min) => score >= min);
    return level === -1 ? core.VERDICTS.length - 1 : level;
  };
  const points = (ratings, goal) => GOLD.reduce((sum, id) => sum + (ratings[id] - 1) * core.GOALS[goal].weights[id], 0);

  // The app's verdict, as if `goal` were chosen; while gates are open, a line
  // is failed or gold lines are unrated, where the points would land once
  // every gate passed, with the unrated lines from 1 star to 5.
  function verdictFor(idea, goal = idea.goal) {
    const failedGates = GATES.filter((id) => idea.gates[id] === 'fail');
    const failedByHand = STAR_IDS.filter((id) => core.criterionSettings(idea.settings, id).failVerdict);
    const openGates = GATES.filter((id) => !idea.gates[id]);
    const rated = GOLD.filter((id) => idea.ratings[id] != null).length;
    const v = { goal: goal || 'none', failedGates, failedByHand, openGates, goldRated: rated, goldTotal: GOLD.length };
    if (!core.isGoal(goal)) return { ...v, status: 'no-goal' };
    v.max = GOLD.reduce((sum, id) => sum + 4 * core.GOALS[goal].weights[id], 0);
    if (failedGates.length || failedByHand.length || openGates.length || rated < GOLD.length) {
      v.status = failedGates.length || failedByHand.length ? 'failed' : 'incomplete';
      const low = points(Object.fromEntries(GOLD.map((id) => [id, idea.ratings[id] ?? 1])), goal);
      const high = points(Object.fromEntries(GOLD.map((id) => [id, idea.ratings[id] ?? 5])), goal);
      // Every verdict on the way, worst first.
      v.ifGatesPass = { low, high, verdicts: core.VERDICTS.slice(band(goal, high), band(goal, low) + 1).reverse() };
      return v;
    }
    const score = points(idea.ratings, goal);
    const level = band(goal, score);
    Object.assign(v, { status: 'scored', points: score, verdict: core.VERDICTS[level] });
    if (level > 0) {
      const at = core.GOALS[goal].bands[level - 1];
      v.next = { verdict: core.VERDICTS[level - 1], at, needed: at - score };
    }
    return v;
  }

  // Gold lines by the points one more star adds, for lines rated below 5.
  function upside(idea, goal) {
    return GOLD.filter((id) => idea.ratings[id] != null && idea.ratings[id] < 5)
      .map((id) => {
        const w = core.GOALS[goal].weights[id];
        return { id, name: nameOf(id), stars: idea.ratings[id], perStar: w, toFive: (5 - idea.ratings[id]) * w };
      })
      .sort((a, b) => b.perStar - a.perStar || a.stars - b.stars);
  }

  function analyze(idea) {
    const s = core.scoreIdea(idea);
    const out = {
      name: idea.name,
      goal: idea.goal || 'none',
      // Rounded as the app shows it (toFixed rounds the exact value half up).
      averageStars: { average: s.average == null ? null : Number(s.average.toFixed(2)), rated: s.rated, counted: s.total },
      result: verdictFor(idea),
    };
    if (idea.goal) out.biggestGainsPerStar = upside(idea, idea.goal);
    else out.ifGoal = { income: verdictFor(idea, 'income'), asset: verdictFor(idea, 'asset') };
    return out;
  }

  // ---------- Ideas the model describes ----------

  const clone = (idea) => JSON.parse(JSON.stringify(idea));
  const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  // Stars as the model may send them: a whole number from 1 to 5, as a number
  // or as text. Anything else (true, [4], "0x5", 4.5) is 0, which is refused.
  const stars = (value) => {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*[1-5]\s*$/.test(value) ? Number(value) : 0;
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0;
  };

  // A value the model sent, as it reads in a problem: text as it is, anything
  // else as JSON. String() or a template literal would call a `toString` the
  // model sent as a key, and throw.
  const shown = (v) => (typeof v === 'string' ? v : String(JSON.stringify(v)));

  // Applies the fields the model sent to a copy of `base` (a saved idea, or a
  // new one), and lists anything it can't take. The app's limits are checked
  // here, so the model can correct itself before the founder sees a card.
  function applySpec(base, spec, problems) {
    const idea = clone(base);
    if (spec.name !== undefined) {
      const name = core.cleanText(spec.name).trim();
      if (!name) problems.push('name is empty');
      else if (core.textLength(name) > core.TEXT_LIMITS.name) problems.push(`name is over ${core.TEXT_LIMITS.name} characters`);
      else idea.name = name;
    }
    if (spec.goal !== undefined) {
      const goal = spec.goal === 'none' ? '' : spec.goal;
      if (goal && !core.isGoal(goal)) problems.push(`goal "${shown(spec.goal)}" is not income, asset or none`);
      // Only a new goal moves the weights to its own; the same goal keeps any the founder set.
      else if (goal !== idea.goal) {
        core.setGoal(idea, goal);
        // No goal: the 12 weights go back to 1, as a new idea with no goal has them.
        if (!goal) for (const id of core.SCORECARD_IDS) idea.settings.criteria[id].weight = 1;
      }
    }
    if (spec.status !== undefined) {
      if (!core.STATUSES.includes(spec.status)) problems.push(`status must be one of ${core.STATUSES.join(', ')}`);
      else idea.status = spec.status;
    }
    if (spec.tags !== undefined) {
      const tags = core.normalizeTags(spec.tags);
      if (core.textLength(tags.join(', ')) > core.TEXT_LIMITS.tags) problems.push(`tags are over ${core.TEXT_LIMITS.tags} characters in all`);
      else idea.tags = tags;
    }
    if (spec.ideaNotes !== undefined) {
      const notes = core.cleanText(spec.ideaNotes);
      if (core.textLength(notes) > core.TEXT_LIMITS.notes) problems.push(`ideaNotes are over ${core.TEXT_LIMITS.notes} characters`);
      else idea.notes = notes;
    }
    for (const field of ['gates', 'ratings', 'notes']) {
      if (spec[field] !== undefined && spec[field] !== null && !isRecord(spec[field])) problems.push(`${field} must be an object, line id to value`);
    }
    for (const [id, value] of Object.entries(isRecord(spec.gates) ? spec.gates : {})) {
      if (!GATES.includes(id)) problems.push(`"${id}" is not a gate`);
      else if (value === 'open' || value === null) delete idea.gates[id];
      else if (value === 'pass' || value === 'fail') idea.gates[id] = value;
      else problems.push(`gate ${id} must be pass, fail or open`);
    }
    for (const [id, value] of Object.entries(isRecord(spec.ratings) ? spec.ratings : {})) {
      if (!STAR_IDS.includes(id)) problems.push(`"${id}" is not a star line`);
      else if (!stars(value)) problems.push(`${id} must be 1 to 5 stars`);
      else idea.ratings[id] = stars(value);
    }
    for (const [id, text] of Object.entries(isRecord(spec.notes) ? spec.notes : {})) {
      const note = core.cleanText(text);
      if (!STAR_IDS.includes(id) && !GATES.includes(id)) problems.push(`"${id}" is not a line`);
      else if (typeof text !== 'string' && text !== null) problems.push(`the note on ${id} must be text, or null to remove it`);
      else if (core.textLength(note) > core.TEXT_LIMITS.ratingNote) problems.push(`the note on ${id} is over ${core.TEXT_LIMITS.ratingNote} characters`);
      else if (note.trim()) idea.ratingNotes[id] = note;
      else delete idea.ratingNotes[id];
    }
    return idea;
  }

  // The idea a tool call is about: a saved one, one the model describes, or a
  // saved one with the model's changes on top.
  function ideaFor(args, ideas, problems) {
    let base = null;
    if (args.id !== undefined) {
      base = ideas.find((i) => i.id === args.id);
      if (!base) problems.push(`no saved idea has the id "${shown(args.id)}"; call list_ideas for the ids`);
    }
    if (!base && args.id === undefined && !isRecord(args.idea)) problems.push('give an id or an idea');
    if (problems.length) return null;
    const start = base || core.createIdea({ name: 'Unnamed idea', ratings: {} });
    if (!base) start.ratings = {};
    return isRecord(args.idea) ? applySpec(start, args.idea, problems) : clone(start);
  }

  function summary(idea) {
    const a = analyze(idea);
    const r = a.result;
    return {
      id: idea.id,
      name: idea.name,
      goal: a.goal,
      status: idea.status,
      tags: idea.tags,
      notes: [...idea.notes].length > 300 ? `${[...idea.notes].slice(0, 300).join('')}…` : idea.notes,
      verdict: r.status === 'scored' ? r.verdict : r.status === 'failed' ? (r.failedGates.length ? 'Gate failed' : 'Failed by hand') : 'No verdict yet',
      points: r.status === 'scored' ? `${r.points} of ${r.max}` : null,
      averageStars: a.averageStars.average,
      linesRated: `${a.averageStars.rated} of ${STAR_IDS.length}`,
    };
  }

  function detail(idea) {
    const lines = Object.fromEntries(
      STAR_IDS.map((id) => {
        const s = core.criterionSettings(idea.settings, id);
        const line = { name: nameOf(id), stars: idea.ratings[id] ?? null };
        if (idea.ratingNotes[id]) line.note = idea.ratingNotes[id];
        if (!s.enabled) line.counts = false;
        if (s.failVerdict) line.failedByHand = true;
        const usual = GOLD.includes(id) && idea.goal ? core.GOALS[idea.goal].weights[id] : 1;
        if (s.weight !== usual) line.weight = s.weight;
        return [id, line];
      })
    );
    const gates = Object.fromEntries(GATES.map((id) => [id, { name: nameOf(id), answer: idea.gates[id] || 'open', ...(idea.ratingNotes[id] ? { note: idea.ratingNotes[id] } : {}) }]));
    return { id: idea.id, name: idea.name, goal: idea.goal || 'none', status: idea.status, tags: idea.tags, notes: idea.notes, gates, lines, score: analyze(idea) };
  }

  // A proposal checked against the saved ideas: the idea as it would be
  // saved, the one it changes (for an update), and what is wrong with it.
  function checkProposal(args, ideas) {
    const problems = [];
    if (!isRecord(args)) return { problems: ['send the proposal as an object'] };
    if (args.mode !== 'new' && args.mode !== 'update') problems.push('mode must be "new" or "update"');
    let before = null;
    if (args.mode === 'update') {
      before = ideas.find((i) => i.id === args.id) || null;
      if (!before) problems.push(`no saved idea has the id "${shown(args.id)}"`);
    }
    if (problems.length) return { problems };
    if (args.mode === 'new' && !core.cleanText(args.name).trim()) problems.push('a new idea needs a name');
    const start = before || core.createIdea({ name: 'Unnamed idea' });
    if (!before) start.ratings = {};
    const after = applySpec(start, args, problems);
    return { before, after, problems };
  }

  // What the card lists: for a change to a saved idea, every difference;
  // for a new idea, everything it holds besides its stars and gates (shown as
  // counts). Text the model wrote is listed in full, so nothing is saved
  // unseen.
  function changes(before, after) {
    const out = [];
    if (!before) {
      out.push({ what: 'Status', from: '', to: after.status, text: true });
      if (after.tags.length) out.push({ what: 'Tags', from: '', to: after.tags.join(', '), text: true });
      if (after.notes.trim()) out.push({ what: 'Notes', from: '', to: after.notes, text: true });
      for (const id of STAR_IDS.concat(GATES)) if (after.ratingNotes[id]) out.push({ what: `Note on ${nameOf(id)}`, from: '', to: after.ratingNotes[id], text: true });
      return out;
    }
    if (before.name !== after.name) out.push({ what: 'Name', from: before.name, to: after.name });
    if (before.goal !== after.goal) out.push({ what: 'Goal', from: before.goal || 'none', to: after.goal || 'none' });
    if (before.status !== after.status) out.push({ what: 'Status', from: before.status, to: after.status });
    if (before.tags.join(', ') !== after.tags.join(', ')) out.push({ what: 'Tags', from: before.tags.join(', ') || '–', to: after.tags.join(', ') || '–' });
    if (before.notes !== after.notes) out.push({ what: 'Notes', from: '', to: after.notes, text: true });
    for (const id of GATES) if ((before.gates[id] || 'open') !== (after.gates[id] || 'open')) out.push({ what: nameOf(id), from: before.gates[id] || 'open', to: after.gates[id] || 'open' });
    for (const id of STAR_IDS) if ((before.ratings[id] ?? null) !== (after.ratings[id] ?? null)) out.push({ what: nameOf(id), from: before.ratings[id] ?? '–', to: after.ratings[id] ?? '–', stars: true });
    for (const id of STAR_IDS.concat(GATES)) {
      if ((before.ratingNotes[id] || '') !== (after.ratingNotes[id] || '')) out.push({ what: `Note on ${nameOf(id)}`, from: '', to: after.ratingNotes[id] || '(removed)', text: true });
    }
    // Settings: a new goal moves the 12 weights.
    for (const id of STAR_IDS) {
      const was = core.criterionSettings(before.settings, id);
      const now = core.criterionSettings(after.settings, id);
      if (was.weight !== now.weight) out.push({ what: `Weight of ${nameOf(id)}`, from: `×${was.weight}`, to: `×${now.weight}` });
      if (was.enabled !== now.enabled) out.push({ what: `${nameOf(id)} counts`, from: was.enabled ? 'yes' : 'no', to: now.enabled ? 'yes' : 'no' });
      if (was.failVerdict !== now.failVerdict) out.push({ what: `${nameOf(id)} fails the verdict`, from: was.failVerdict ? 'yes' : 'no', to: now.failVerdict ? 'yes' : 'no' });
    }
    return out;
  }

  // Runs one of the model's tool calls on the founder's ideas. Returns the
  // JSON the model gets back; propose_idea also returns the checked proposal
  // for the app to show.
  function runTool(name, args, ideas) {
    // A call that still throws (arguments shaped in a way nothing here
    // expects) gets an error back, so the conversation gets its tool result.
    try {
      return runCall(name, args, ideas);
    } catch {
      return { result: { error: "The call couldn't be run with these arguments. Check them against the tool's schema and send it again." } };
    }
  }

  function runCall(name, args, ideas) {
    const problems = [];
    let parsed = args;
    if (typeof args === 'string') {
      try {
        parsed = args.trim() ? JSON.parse(args) : {};
      } catch {
        return { result: { error: 'The arguments were not valid JSON. Send them again.' } };
      }
    }
    if (!isRecord(parsed)) parsed = {};
    if (name === 'list_ideas') return { result: { count: ideas.length, limit: core.MAX_IDEAS, ideas: ideas.map(summary) } };
    if (name === 'get_idea') {
      const idea = ideas.find((i) => i.id === parsed.id);
      return { result: idea ? detail(idea) : { error: `No saved idea has the id "${shown(parsed.id)}". Call list_ideas for the ids.` } };
    }
    if (name === 'score_idea') {
      const idea = ideaFor(parsed, ideas, problems);
      if (!idea) return { result: { error: problems.join('; ') } };
      for (const field of ['set', 'gates']) {
        if (parsed[field] !== undefined && parsed[field] !== null && !isRecord(parsed[field])) problems.push(`${field} must be an object, line id to value`);
      }
      const what = { set: parsed.set, gates: parsed.gates, ...(parsed.goal !== undefined ? { goal: parsed.goal } : {}) };
      const whatIf = isRecord(parsed.set) || isRecord(parsed.gates) || parsed.goal !== undefined;
      const after = whatIf ? applySpec(idea, { ratings: what.set, gates: what.gates, goal: what.goal }, problems) : null;
      const result = whatIf ? { before: analyze(idea), after: analyze(after) } : analyze(idea);
      if (whatIf && result.before.result.status === 'scored' && result.after.result.status === 'scored' && result.before.goal === result.after.goal) {
        result.pointsChange = result.after.result.points - result.before.result.points;
      }
      if (problems.length) result.problems = problems;
      return { result };
    }
    if (name === 'propose_idea') {
      const proposal = checkProposal(parsed, ideas);
      if (proposal.problems.length) return { result: { error: `Not shown: ${proposal.problems.join('; ')}. Fix these and call propose_idea again.` } };
      return {
        result: { shown: true, note: 'The founder sees a card with this proposal and its score. Nothing is saved until they click; their next message says what they chose.', score: analyze(proposal.after) },
        proposal,
      };
    }
    return { result: { error: `There is no tool called "${shown(name)}".` } };
  }

  // ---------- The chat's text as HTML ----------

  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  // **bold**, *italic* and `code` within a line, on text already escaped.
  // Code is set aside first, so nothing in it is read as bold or italic and
  // tags always nest. Its place is marked with NUL characters, so any the
  // text has of its own are dropped first: they would read as a mark.
  function inline(text) {
    const code = [];
    return escapeHTML(String(text ?? '').replace(/\u0000/g, ''))
      .replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`)
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
  }

  // A table row's cells: split at each | outside `code`.
  const cells = (line) => {
    const out = [''];
    let inCode = false;
    for (const ch of line.trim().replace(/^\||\|$/g, '')) {
      if (ch === '`') inCode = !inCode;
      if (ch === '|' && !inCode) out.push('');
      else out[out.length - 1] += ch;
    }
    return out.map((c) => c.trim());
  };

  // The Markdown the model writes (headings, paragraphs, lists, tables, ---),
  // as HTML. Everything is escaped first, so nothing the model writes becomes
  // a tag, link or attribute.
  function renderMarkdown(text) {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null;
    const flush = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
      list = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (!line.trim()) flush();
      else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flush();
        out.push('<hr>');
      } else if (heading) {
        flush();
        const level = Math.min(heading[1].length + 2, 6);
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
        flush();
        const head = cells(line);
        const rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
        i--;
        out.push(
          '<div class="coach-table"><table><thead><tr>' +
            head.map((c) => `<th>${inline(c)}</th>`).join('') +
            '</tr></thead><tbody>' +
            rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
            '</tbody></table></div>'
        );
      } else if (bullet || numbered) {
        const tag = bullet ? 'ul' : 'ol';
        if (para.length || (list && list.tag !== tag)) flush();
        if (!list) list = { tag, items: [] };
        list.items.push((bullet || numbered)[1]);
      } else if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`;
      } else {
        if (list) flush();
        para.push(line);
      }
    }
    flush();
    return out.join('');
  }

  return { TOOLS, TOOL_NAMES, MAX_TOOL_CALLS, MAX_CHAT_BYTES, CALL_ID, buildGuides, frameworkTables, buildSystemPrompt, runTool, analyze, verdictFor, changes, checkProposal, renderMarkdown, STAR_IDS };
});

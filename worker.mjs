// The site's only server code (Cloudflare Workers). Everything else is static
// files served by Cloudflare. wrangler.jsonc sends two paths here first:
//
//   /p/<slug>      an idea's published production page, read from Supabase and
//                  served with scripts, forms and outside requests blocked
//   /p/<slug>/<code>  one of the idea's published drafts, served the same way
//   /api/generate  passes a signed-in, invited person's request on to Meta's
//                  API, for the Meta model they chose, with their own API key,
//                  and streams the answer back
//   /api/chat      the same for Coach (src/coach.js): a conversation, with the
//                  Coach's tools, which run in the person's browser
//   /api/landscape reviews an idea's competition (src/landscape.js): a few
//                  steps with Meta's web search (its Responses API), run here
//                  with the person's key; how far it has got, then the review,
//                  stream back
//
// The person's API key is only passed through: it is never stored or logged.

import core from './src/core.js';
import coach from './src/coach.js';
import descriptions from './src/descriptions.js';
import landscape from './src/landscape.js';
import landing from './src/landing.js';

// The provider: Meta's chat completions endpoint, which
// takes the key as "Authorization: Bearer". `instructions` is the role the
// app's developer message goes as (Meta ranks "developer" above the user).
// `settings` go with every request: the token limit counts the model's
// reasoning too (a page is about 6,000 to 8,000 tokens). `search` is where a
// competition review runs (Meta's Responses API, with its built-in web
// search) and the `include` that asks for each search's results.
const PROVIDERS = {
  meta: {
    name: 'Meta',
    url: 'https://api.meta.ai/v1/chat/completions',
    instructions: 'developer',
    settings: { max_completion_tokens: 32768, reasoning_effort: 'medium' },
    search: { url: 'https://api.meta.ai/v1/responses', results: 'web_search_call.results' },
  },
};
// The same models as MODELS in src/landing.js, with their providers (a test
// checks they match).
const MODELS = { 'muse-spark-1.3': 'meta', 'muse-spark-1.3-contributor': 'meta', 'muse-wonder-1.0': 'meta' };
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// 10 characters for new drafts, 6 for drafts made before.
const DRAFT_CODE_PATTERN = /^[a-z0-9]{6}(?:[a-z0-9]{4})?$/;
// The longest request the app sends is about 120 KB: notes on every line, each
// full of 4-byte characters.
const MAX_REQUEST_BYTES = 256 * 1024;
// A Coach conversation is sent whole every turn: the rules and line guides
// (about 60 KB), every message, and what the tools answered.
const MAX_CHAT_BYTES = coach.MAX_CHAT_BYTES;
const MAX_CHAT_MESSAGES = 400;
// Coach's tools, which only it may call. The Worker sends them itself, so a
// request can't bring tools of its own.
const TOOL_NAMES = new Set(coach.TOOL_NAMES);

// A published page is someone's own HTML, written by a model. The sandbox gives
// it an origin of its own, so it can't reach this site's sign-in or stored API
// keys, and the rest blocks scripts, forms and anything loaded from elsewhere.
// It can't open new windows either (no allow-popups), so a link can't leave
// this page open behind a new tab. A link can still take the visitor's own tab
// elsewhere: no sandbox flag stops a page navigating itself. Generated pages
// link only within themselves (src/landing.js), so nothing of theirs is lost.
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  // Not kept anywhere: taking a page down, or removing its owner's invite, takes it down at once.
  'cache-control': 'no-store',
};

const STREAM_HEADERS = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

// An answer's stream with a keepalive comment (": keepalive", which the app
// reads past) every 15 seconds the stream is quiet, as a review's has. A model
// can think for minutes before it writes, and Meta sends nothing meanwhile;
// without it the app would take the silence for a stalled provider and stop
// (QUIET_MS in src/cloud.js). Keepalives say only that this Worker is still
// there, so it watches the provider itself: once the provider has sent
// nothing for ANSWER_IDLE_MS (`heard` counts what it sends before any
// translation drops it), the answer ends with an error and the provider's
// stream is cancelled. Keepalives go only between events, never inside one;
// the idle stop comes even mid-event (a provider can stall there too), after
// a blank line that ends the half event. Closing the page still cancels the
// provider's stream.
const ANSWER_IDLE_MS = 10 * 60 * 1000;
function withKeepalive(source, providerName) {
  const reader = source.getReader();
  const encoder = new TextEncoder();
  const keepalive = encoder.encode(': keepalive\n\n');
  let timer;
  let last = Date.now();
  let tail = new Uint8Array(0);
  let between = true;
  let finished = false;
  const heard = () => {
    last = Date.now();
  };
  const finish = () => {
    finished = true;
    clearInterval(timer);
  };
  const stream = new ReadableStream({
    start(controller) {
      timer = setInterval(() => {
        if (finished) return;
        if (Date.now() - last < ANSWER_IDLE_MS) {
          if (between) controller.enqueue(keepalive);
          return;
        }
        finish();
        const message = `${providerName} sent nothing for 10 minutes, so the request was stopped. Try again.`;
        // Mid-event, a blank line first ends the half event, which the app
        // can't parse and reads past, so the error still reaches it.
        const close = between ? '' : '\n\n';
        controller.enqueue(encoder.encode(`${close}data: ${JSON.stringify({ error: { message } })}\n\ndata: [DONE]\n\n`));
        controller.close();
        reader.cancel().catch(() => {});
      }, KEEPALIVE_MS);
      // In Node (the tests), a stream nobody reads to the end mustn't keep the process alive.
      timer?.unref?.();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) {
          finish();
          controller.close();
          return;
        }
        heard();
        controller.enqueue(value);
        // Whether the stream now stands between two events: the last bytes
        // so far, across chunks, end in a blank line.
        const joined = new Uint8Array(tail.length + value.length);
        joined.set(tail);
        joined.set(value, tail.length);
        tail = joined.slice(-4);
        const end = new TextDecoder().decode(tail);
        between = end.endsWith('\n\n') || end.endsWith('\r\n\r\n');
      } catch (err) {
        if (finished) return;
        finish();
        controller.error(err);
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
  return { stream, heard };
}

const API_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

// The request's body as text, or null when it is longer than `max` bytes. It
// stops reading at the limit, so a huge body (which anyone can send, signed in
// or not) is never held in memory.
async function readBody(request, max) {
  if (Number(request.headers.get('content-length')) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: API_HEADERS });
const fail = (status, error) => json(status, { error });

function notFound() {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Page not found</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#18202e;background:#eef0f3}' +
    'main{max-width:32rem;padding:24px}@media (prefers-color-scheme:dark){body{color:#e6e9ef;background:#0f131a}}</style></head>' +
    "<body><main><h1>Page not found</h1><p>This landing page doesn't exist, or it was taken down.</p></main></body></html>";
  return new Response(html, { status: 404, headers: { ...PAGE_HEADERS, 'cache-control': 'no-store' } });
}

// Requests to Supabase go with the publishable key, as the anon role, unless a
// person's token is given.
function supabase(env, path, init = {}, token = null) {
  const headers = { apikey: env.SUPABASE_KEY, ...init.headers };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${env.SUPABASE_URL}${path}`, { ...init, headers });
}

// The production page at /p/<slug>, or with a draft's code, that draft. Drafts
// are kept out of search engines: they are for comparing and sharing, and the
// production page is the one to find.
async function servePage(slug, code, env) {
  if (!SLUG_PATTERN.test(slug) || slug.length > 64 || (code !== undefined && !DRAFT_CODE_PATTERN.test(code))) return notFound();
  const path =
    code === undefined
      ? `/rest/v1/rpc/landing_page?page_slug=${encodeURIComponent(slug)}`
      : `/rest/v1/rpc/landing_draft?page_slug=${encodeURIComponent(slug)}&draft_code=${encodeURIComponent(code)}`;
  let html;
  try {
    const res = await supabase(env, path);
    if (!res.ok) throw new Error(`Supabase answered ${res.status}`);
    html = await res.json();
  } catch {
    return new Response("This page couldn't be loaded just now. Try again in a moment.", {
      status: 502,
      headers: { ...PAGE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (typeof html !== 'string' || !html) return notFound();
  return new Response(html, { headers: code === undefined ? PAGE_HEADERS : { ...PAGE_HEADERS, 'x-robots-tag': 'noindex' } });
}

// Only what the app sends: a model from the list and a few developer and user
// messages. Anything else is refused, so this can't be used to send other
// requests with someone's key.
function readRequest(body) {
  // A string, so a list such as ["muse-spark-1.3"] doesn't pass as the name it turns into.
  if (!body || typeof body !== 'object' || typeof body.model !== 'string' || !Object.hasOwn(MODELS, body.model)) return null;
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 4) return null;
  const ok = messages.every((m) => m && (m.role === 'developer' || m.role === 'user') && typeof m.content === 'string' && m.content);
  return ok ? { model: body.model, messages: messages.map(({ role, content }) => ({ role, content })) } : null;
}

const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max = MAX_CHAT_BYTES) => typeof v === 'string' && v.length <= max;
// What may come back of an earlier answer: tool call ids. src/coach.js holds
// the check, which the app uses too, so it never keeps an answer this would
// refuse.
const { CALL_ID } = coach;

// A Coach conversation: a model from the list, and messages as the app sends
// them: its rules (developer), the person's messages (user), the model's
// answers with the tools it called (assistant), and what each tool gave back
// (tool). Tool calls can only name Coach's tools. Anything else is refused,
// except fields that models the app no longer offers once added to an answer
// (a provider's own copy of it, a tool call's `extra_content`): a conversation
// saved with them still goes, without them.
function readChat(body) {
  if (!isRecord(body) || typeof body.model !== 'string' || !Object.hasOwn(MODELS, body.model)) return null;
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > MAX_CHAT_MESSAGES) return null;
  const out = [];
  for (const m of messages) {
    if (!isRecord(m)) return null;
    if (m.role === 'developer' || m.role === 'user') {
      if (!isText(m.content) || !m.content) return null;
      out.push({ role: m.role, content: m.content });
    } else if (m.role === 'assistant') {
      const content = m.content ?? '';
      const calls = m.tool_calls ?? [];
      if (!isText(content) || !Array.isArray(calls) || calls.length > coach.MAX_TOOL_CALLS) return null;
      const toolCalls = [];
      for (const c of calls) {
        if (!isRecord(c) || typeof c.id !== 'string' || !CALL_ID.test(c.id) || !isRecord(c.function)) return null;
        if (!TOOL_NAMES.has(c.function.name) || !isText(c.function.arguments)) return null;
        toolCalls.push({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments } });
      }
      if (!content && !toolCalls.length) return null;
      out.push({ role: 'assistant', content, toolCalls });
    } else if (m.role === 'tool') {
      if (typeof m.tool_call_id !== 'string' || !CALL_ID.test(m.tool_call_id) || !isText(m.content)) return null;
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    } else return null;
  }
  return { model: body.model, messages: out };
}

// A review of one idea's competition: the idea, as the app holds it, the
// models to run it on (a key of landscape.REVIEW_MODELS; Meta's pair when
// none is named), and nothing else. The idea is read the way the app reads a
// saved idea, so only its own fields go on to the provider.
function readLandscape(body) {
  if (!isRecord(body) || !isRecord(body.idea) || Object.keys(body).some((k) => k !== 'idea' && k !== 'models')) return null;
  const models = body.models === undefined ? landscape.DEFAULT_MODELS : body.models;
  if (typeof models !== 'string' || !Object.hasOwn(landscape.REVIEW_MODELS, models)) return null;
  if (typeof body.idea.name !== 'string' || !body.idea.name.trim()) return null;
  const idea = core.sanitizeIdea(body.idea);
  return idea ? { idea, models } : null;
}

// What the provider said went wrong, as plain text. The error may be wrapped
// in a list, or given as a plain string.
async function vendorError(res) {
  try {
    const answer = await res.json();
    const body = Array.isArray(answer) ? answer[0] : answer;
    const message = body?.error?.message || (typeof body?.error === 'string' && body.error) || body?.message || body?.detail;
    if (typeof message === 'string' && message) return message.slice(0, 300);
  } catch {
    // No readable reason.
  }
  return `HTTP ${res.status}`;
}

// The two routes that call a provider with the person's key: what each
// accepts, how big it may be, and what it says when sign-in is missing.
const ROUTES = {
  generate: { read: readRequest, maxBytes: MAX_REQUEST_BYTES, tooBig: 'The idea is too long to send.', signIn: 'Sign in to generate a landing page.' },
  chat: { read: readChat, maxBytes: MAX_CHAT_BYTES, tooBig: 'This conversation is too long to send. Start a new one.', signIn: 'Sign in to use Coach.' },
  landscape: { read: readLandscape, maxBytes: MAX_REQUEST_BYTES, tooBig: 'The idea is too long to send.', signIn: 'Sign in to review the competition.' },
};

async function generate(request, env, kind = 'generate') {
  const route = ROUTES[kind];
  if (request.method !== 'POST') return fail(405, 'Use POST.');
  // Only the app itself may ask, from this site's own pages.
  if (request.headers.get('origin') !== new URL(request.url).origin) return fail(403, 'Requests must come from this site.');
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const apiKey = request.headers.get('x-model-api-key') || '';
  if (!token) return fail(401, route.signIn);
  if (!apiKey) return fail(400, 'Add your API key first.');
  let text;
  try {
    text = await readBody(request, route.maxBytes);
  } catch {
    return fail(400, 'The request could not be read.');
  }
  if (text === null) return fail(413, route.tooBig);
  let wanted;
  try {
    wanted = route.read(JSON.parse(text));
  } catch {
    wanted = null;
  }
  if (!wanted) return fail(400, 'The request was not one this site sends.');

  // Only invited people who are signed in: the database checks the token.
  let invited = false;
  try {
    const res = await supabase(env, '/rest/v1/rpc/is_invited', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, token);
    // Only a refused sign-in (401, 403) or a clear no means not invited; any
    // other answer (a rate limit, an outage) is a check that didn't happen.
    if (!res.ok && res.status !== 401 && res.status !== 403) throw new Error(`Supabase answered ${res.status}`);
    invited = res.ok && (await res.json()) === true;
  } catch {
    return fail(502, "Your sign-in couldn't be checked just now. Try again in a moment.");
  }
  if (!invited) return fail(401, 'Your sign-in has ended or your invite was removed. Sign in again.');

  if (kind === 'landscape') return streamLandscape(apiKey, wanted.idea, wanted.models);
  // Timed from here, so the wait for the provider's first answer counts too.
  const started = Date.now();
  return logAnswer(await answer(kind, wanted, apiKey), started, { route: kind, provider: MODELS[wanted.model], model: wanted.model });
}

// A landing page or a Coach answer from the model's provider, streamed back
// as chat completion chunks.
async function answer(kind, wanted, apiKey) {
  const provider = PROVIDERS[MODELS[wanted.model]];
  // Streamed, because Meta cuts off a long request that isn't (with a 504).
  const body = {
    model: wanted.model,
    messages: kind === 'chat' ? chatMessages(wanted.messages, provider) : wanted.messages.map((m) => (m.role === 'developer' ? { role: provider.instructions, content: m.content } : m)),
    ...(kind === 'chat' ? { tools: coach.TOOLS } : {}),
    stream: true,
    ...provider.settings,
  };
  let res;
  try {
    res = await fetch(provider.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return json(502, { error: `${provider.name}'s API couldn't be reached. Try again in a moment.`, vendor: provider.name });
  }
  if (!res.ok || !res.body) return json(502, { error: await vendorError(res), vendorStatus: res.status, vendor: provider.name });
  // The provider's stream goes straight on to the app, which puts the page
  // together (streamReader in src/landing.js) and shows how far it has got.
  return new Response(withKeepalive(res.body, provider.name).stream, { headers: STREAM_HEADERS });
}

// One log line per landing page or Coach answer (Workers Logs,
// wrangler.jsonc), as reviews have: how it ended, how long it took, how long
// the model thought before it wrote, and how much it sent. Never the key, the
// idea's text, what the model wrote or a provider's own error message (one
// can quote the key back). The stream is only looked at, never changed: it is
// read line by line (a line may arrive in many pieces), with cheap string
// checks, and only a line with the token count is parsed, so it costs little
// CPU on a long answer. `firstThought` and `firstText` are seconds from
// `started` (the request) to the model's first reasoning and first text;
// `usage` is the provider's token count, when it sends one.
function logAnswer(res, started, fields) {
  const seconds = (at = Date.now()) => Math.round((at - started) / 100) / 10;
  const write = (more) => console.log(JSON.stringify({ ...fields, ...more }));
  if (!res.body || res.status !== 200) {
    res
      .clone()
      .json()
      .then(
        (body) => write({ outcome: 'refused', status: res.status, vendorStatus: body?.vendorStatus }),
        () => write({ outcome: 'refused', status: res.status })
      );
    return res;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let firstThought = null;
  let firstText = null;
  let finish = null;
  let error = false;
  let usage;
  let bytes = 0;
  let logged = false;
  let buffer = '';
  const end = (outcome) => {
    if (logged) return;
    logged = true;
    write({ outcome: error ? 'error' : outcome, seconds: seconds(), firstThought, firstText, finish, bytes, ...(usage ? { usage } : {}) });
  };
  // One whole line of the stream. JSON may have spaces around its colons.
  const line = (text) => {
    if (!text.startsWith('data:')) return;
    if (firstThought === null && /"reasoning(_content)?"\s*:\s*"[^"]/.test(text)) firstThought = seconds();
    if (firstText === null && /"content"\s*:\s*"[^"]/.test(text)) firstText = seconds();
    const reason = text.match(/"finish_reason"\s*:\s*"(\w+)"/);
    if (reason) finish = reason[1];
    if (/^data:\s*\{\s*"error"\s*:/.test(text)) error = true;
    if (text.includes('"usage"')) {
      try {
        const u = JSON.parse(text.slice(5)).usage;
        if (u && typeof u === 'object') usage = Object.fromEntries(Object.entries(u).filter(([, v]) => typeof v === 'number' || (v && typeof v === 'object')));
      } catch {
        // Not an event with a token count.
      }
    }
  };
  const look = (text) => {
    const lines = (buffer + text).split('\n');
    buffer = lines.pop();
    for (const l of lines) line(l.trimEnd());
  };
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          look(decoder.decode() + '\n');
          end('done');
          return controller.close();
        }
        bytes += value.byteLength;
        look(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (err) {
        end('failed');
        controller.error(err);
      }
    },
    cancel(reason) {
      end('stopped');
      return reader.cancel(reason);
    },
  });
  return new Response(stream, { status: res.status, headers: res.headers });
}

// A Coach conversation as the chat completions endpoint takes it.
function chatMessages(messages, provider) {
  return messages.map((m) => {
    if (m.role === 'developer') return { role: provider.instructions, content: m.content };
    if (m.role !== 'assistant') return m;
    const out = { role: 'assistant', content: m.content || null };
    if (m.toolCalls.length) out.tool_calls = m.toolCalls;
    return out;
  });
}

// ---------- Landscape ----------

// One step of a review may take this long in all, and may go this long
// without a word from the provider (searching, then thinking, then writing).
const STEP_LIMIT_MS = 4 * 60 * 1000;
const STEP_IDLE_MS = 150 * 1000;
// A comment line this often while a review runs, so nothing between here and
// the browser closes a connection that looks idle.
const KEEPALIVE_MS = 15 * 1000;
// Settings Meta may refuse alongside web search (its docs don't say they
// combine): when its refusal names one, the step is sent again without the
// ones it names, and only those; a refusal that names one setting at a time
// gets a try for each. The answer is still JSON, because every step asks for
// it in words too. A setting counts as named by its own name in the message,
// quoted or after "argument"/"parameter", never by words any error may use
// ("text is too long"): otherwise an unrelated refusal would drop
// max_tool_calls, and with it the cap on searches billed to the person's key.
// A refusal of max_tool_calls leaves no cap to give; the step's time limit
// still holds.
const named = (name) => new RegExp(`['"\`]${name}['"\`]|(?:argument|parameter)s?(?: supplied)?:\\s*['"\`]?${name}\\b`, 'i');
const OPTIONAL_SETTINGS = {
  text: [named('text(?:\\.format)?'), /\btext\.format\b|json_schema/i],
  max_tool_calls: [/max_tool_calls/i],
  include: [named('include'), /web_search_call\./i],
};
const refusedSettings = (message) => Object.keys(OPTIONAL_SETTINGS).filter((k) => OPTIONAL_SETTINGS[k].some((p) => p.test(message)));

// One step as Meta's Responses API takes it: streamed, because a long
// request that isn't gets cut off (Meta answers 504), and not stored at the
// provider.
function responsesBody(stage, provider) {
  return {
    model: stage.model,
    instructions: stage.instructions,
    input: [{ role: 'user', content: stage.input }],
    ...(stage.search ? { tools: [{ type: 'web_search' }], include: [provider.search.results], max_tool_calls: stage.maxSearches } : {}),
    text: { format: { type: 'json_schema', name: stage.schemaName, schema: stage.schema, strict: false } },
    reasoning: { effort: stage.effort },
    max_output_tokens: stage.maxOutput,
    store: false,
    stream: true,
  };
}

const failure = (message, vendorStatus) => Object.assign(new Error(message), vendorStatus ? { vendorStatus } : {});
const stepName = (stage) => (stage.step === 'profile' ? `researching ${stage.name}` : stage.step === 'market' ? 'researching the market' : stage.step === 'scout' ? 'finding competitors' : 'writing the review');

// The timers of one step: it is stopped when the browser goes away
// (`signal`), when it has taken too long in all, or when nothing has arrived
// for too long (`heard` resets that). `lost(text)` is the error for a
// connection that broke: why, if the step was stopped.
function stepTimers(signal, what, provider) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener('abort', stop);
  const limit = setTimeout(stop, STEP_LIMIT_MS);
  let idle = setTimeout(stop, STEP_IDLE_MS);
  return {
    signal: controller.signal,
    heard() {
      clearTimeout(idle);
      idle = setTimeout(stop, STEP_IDLE_MS);
    },
    lost: (text) => (signal.aborted ? failure('Stopped.') : controller.signal.aborted ? failure(`${provider.name} took too long ${what}. Try again.`) : failure(text)),
    clear() {
      clearTimeout(limit);
      clearTimeout(idle);
      signal.removeEventListener('abort', stop);
    },
  };
}

// Asks Meta's Responses API for one step of a review and reads its whole
// answer (what landscape.responsesReader reads).
// `onSearch` hears each search; `signal` stops it when the browser goes
// away. Throws on a refusal, a failure, a cut-off answer, or a step that
// takes too long.
async function callResponses(provider, apiKey, stage, onSearch, signal) {
  let body = responsesBody(stage, provider);
  const what = stepName(stage);
  for (let attempt = 0; ; attempt++) {
    // Stopped already (the page closed while other steps ran): nothing more is asked or billed.
    if (signal.aborted) throw failure('Stopped.');
    const timers = stepTimers(signal, what, provider);
    const { lost } = timers;
    try {
      let res;
      try {
        res = await fetch(provider.search.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: timers.signal,
        });
      } catch {
        throw lost(`${provider.name}'s API couldn't be reached. Try again in a moment.`);
      }
      if (!res.ok || !res.body) {
        const message = await vendorError(res);
        const refused = refusedSettings(message).filter((k) => k in body);
        if (res.status === 400 && attempt < Object.keys(OPTIONAL_SETTINGS).length && refused.length) {
          body = Object.fromEntries(Object.entries(body).filter(([k]) => !refused.includes(k)));
          continue;
        }
        throw failure(message, res.status);
      }
      const reader = landscape.responsesReader(onSearch);
      const chunks = res.body.pipeThrough(new TextDecoderStream()).getReader();
      try {
        for (;;) {
          const { done, value } = await chunks.read();
          if (done) break;
          timers.heard();
          reader.push(value);
        }
      } catch {
        throw lost(`The connection to ${provider.name} was lost while ${what}. Try again.`);
      }
      const answer = reader.end();
      if (answer.status === 'failed') throw failure(answer.error, 500);
      if (answer.status === null) throw failure(`${provider.name}'s answer was cut off while ${what}. Try again.`);
      return answer;
    } finally {
      timers.clear();
    }
  }
}

// Runs a review on the pair of models landscape.REVIEW_MODELS keeps under
// `models` and streams it back as server-sent events: how far it has got
// ({ progress }), then the review ({ report }) or what went wrong
// ({ error: { message, vendorStatus } }). Closing the page stops every
// request to the provider, so nothing goes on billing for a review nobody
// will read.
function streamLandscape(apiKey, idea, models) {
  const providerId = landscape.REVIEW_MODELS[models].provider;
  const provider = PROVIDERS[providerId];
  const controller = new AbortController();
  const call = (stage, onSearch) => callResponses(provider, apiKey, stage, onSearch, controller.signal);
  const encoder = new TextEncoder();
  let keepalive;
  const body = new ReadableStream({
    start(out) {
      const write = (text) => {
        try {
          out.enqueue(encoder.encode(text));
        } catch {
          // The browser has gone.
        }
      };
      const send = (event) => write(`data: ${JSON.stringify(event)}\n\n`);
      keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
      // One log line per review (Workers Logs, wrangler.jsonc): how it ended,
      // how long it took and how far it got. Never the key or the idea's text,
      // and never a provider's own error message: one can quote the key or the
      // request back. Its status says enough.
      const started = Date.now();
      let last = { step: 'starting', searches: 0 };
      const log = (fields) => console.log(JSON.stringify({ route: 'landscape', provider: providerId, models, seconds: Math.round((Date.now() - started) / 1000), step: last.step, searches: last.searches, ...fields }));
      landscape
        .run({
          idea,
          descriptions,
          models,
          call,
          emit: (progress) => {
            last = progress;
            send({ progress });
          },
        })
        .then(
          (report) => {
            log({ outcome: 'done', searches: report.searches, competitors: report.competitors.length });
            send({ report });
          },
          (err) => {
            if (controller.signal.aborted) return log({ outcome: 'stopped' });
            const message = String(err?.message || 'The review stopped with an error.').slice(0, 300);
            log({ outcome: 'failed', ...(err?.vendorStatus ? { vendorStatus: err.vendorStatus } : {}) });
            send({ error: { message, ...(err?.vendorStatus ? { vendorStatus: err.vendorStatus } : {}) } });
          }
        )
        .finally(() => {
          clearInterval(keepalive);
          write('data: [DONE]\n\n');
          try {
            out.close();
          } catch {
            // Already closed.
          }
        });
    },
    cancel() {
      clearInterval(keepalive);
      controller.abort();
    },
  });
  return new Response(body, { headers: STREAM_HEADERS });
}

// How often one address may ask (Workers Rate Limiting, `ratelimits` in
// wrangler.jsonc): every published-page request and every /api/* request
// makes the Worker call Supabase, so one client in a loop could otherwise use
// up the plan's daily requests for everyone. Counted per client IP, per
// Cloudflare location, and only roughly (the counts are eventually
// consistent): a brake on loops, not an exact quota. Without the binding (the
// tests, `wrangler dev` without it) or if it fails, requests go through; with
// none, nothing is awaited, so a request's body is read exactly as before.
async function tooMany(limiter, request) {
  const key = request.headers.get('cf-connecting-ip');
  if (!key) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false;
  }
}
const SLOW_DOWN = 'Too many requests from your connection just now. Wait a minute, then try again.';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/p/') && env.PAGE_LIMITER && (await tooMany(env.PAGE_LIMITER, request))) {
      return new Response(SLOW_DOWN, { status: 429, headers: { ...PAGE_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' } });
    }
    if (pathname.startsWith('/api/') && env.API_LIMITER && (await tooMany(env.API_LIMITER, request))) {
      return new Response(JSON.stringify({ error: SLOW_DOWN }), { status: 429, headers: { ...API_HEADERS, 'retry-after': '60' } });
    }
    const page = pathname.match(/^\/p\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (page) return request.method === 'GET' || request.method === 'HEAD' ? servePage(page[1], page[2], env) : fail(405, 'Use GET.');
    if (pathname === '/api/generate') return generate(request, env);
    if (pathname === '/api/chat') return generate(request, env, 'chat');
    if (pathname === '/api/landscape') return generate(request, env, 'landscape');
    if (pathname.startsWith('/p/') || pathname.startsWith('/api/')) return notFound();
    return env.ASSETS.fetch(request);
  },
};

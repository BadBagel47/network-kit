// Playtest Remote (F-091): the play-test panel on another device. It joins the
// pairing room the game page opened (by the link's code or a typed code),
// shows the game's tests, steps and questions, and sends the report through
// the game page, which adds the page's context and screenshots.
import { NetworkRoom } from '../network-kit/client/room.js';
import { shrinkPicture } from '../network-kit/client/playtest.js';

const $ = (id) => document.getElementById(id);
const RESULTS = ['worked', 'partly', 'failed'];
const ANSWERS_KEY = 'nk-remote:answers';
let room = null;
let state = null; // the latest from the game page
let shots = 0; // screenshots kept on the game page for the report
let thumbs = [];
let photos = []; // ids of pictures taken here and already sent to the admin page
let result = null;
let sending = false;

const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [t, fn] of Object.entries(v)) e.addEventListener(t, fn);
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
};
const status = (text) => { $('status').textContent = text; };
const answersFor = (id) => {
  try {
    return JSON.parse(sessionStorage.getItem(`${ANSWERS_KEY}:${id}`) ?? '{}');
  } catch {
    return {};
  }
};
const keepAnswers = (id, answers) => {
  try {
    sessionStorage.setItem(`${ANSWERS_KEY}:${id}`, JSON.stringify(answers));
  } catch {
    // private mode
  }
};

function codeFromHash() {
  const m = /(?:^#|&)code=([A-Za-z0-9]{4,12})/.exec(location.hash);
  return m ? m[1].toUpperCase() : null;
}

async function connect(code) {
  status('Kopplar …');
  $('join-error').textContent = '';
  try {
    room = await NetworkRoom.join(location.origin, { code, basePath: '/playtest/rooms', name: 'Fjärr', role: 'remote' });
  } catch (e) {
    room = null;
    $('join').hidden = false;
    $('join-error').textContent = e?.reason === 'not-found' ? 'Hittar ingen fjärrkontroll med den koden. Visa koden i spelet igen.' : 'Kunde inte koppla. Försök igen.';
    status('');
    return;
  }
  history.replaceState(null, '', `#code=${code}`);
  $('join').hidden = true;
  room.on('message', ({ data }) => fromGame(data));
  room.on('status', (s) => status(s === 'online' ? connectedText() : 'Tappade kontakten, kopplar om …'));
  room.on('room', () => status(connectedText()));
  room.on('closed', () => {
    status('Spelet stängde fjärrkontrollen.');
    $('list').hidden = true;
    $('test').hidden = true;
    $('join').hidden = false;
  });
  room.send({ t: 'hello' });
  status(connectedText());
}

function connectedText() {
  const game = room?.players.find((p) => p.role === 'screen');
  if (!game || game.status !== 'online') return 'Ansluten. Väntar på spelet (laddar det om?) …';
  return `Ansluten till spelet${state?.page?.device ? ` på ${state.page.device}` : ''}.`;
}

function fromGame(data) {
  if (!data || typeof data !== 'object') return;
  if (data.t === 'state') {
    const before = state?.run?.id;
    state = data;
    if (data.run?.id !== before) {
      result = null;
      shots = 0;
      thumbs = [];
      photos = [];
    }
    render();
  } else if (data.t === 'shot') {
    if (data.ok) {
      shots = data.count ?? shots + 1;
      if (data.thumb) thumbs.push(data.thumb);
      $('test-note').textContent = '';
    } else $('test-note').textContent = 'Spelet kunde inte ta en bild här. Ta ett foto av skärmen i stället.';
    renderThumbs();
  } else if (data.t === 'sent') {
    sending = false;
    $('list-note').textContent = data.ok ? 'Skickat. Tack!' : data.queued ? 'Spelet har ingen kontakt just nu; rapporten skickas när det går.' : 'Rapporten kunde inte skickas.';
  }
  status(connectedText());
}

function render() {
  const run = state?.run ? state.items.find((i) => i.id === state.run.id) ?? { id: state.run.id, title: state.run.id, steps: [], links: [], questions: [] } : null;
  $('list').hidden = Boolean(run);
  $('test').hidden = !run;
  if (!run) return renderList();
  const answers = answersFor(run.id);
  $('test-id').textContent = `${run.id}${run.where ? ` · ${run.where}` : ''}`;
  $('test-title').textContent = run.title;
  const step = state.run.step ?? 0;
  $('steps').replaceChildren(...run.steps.map((s, i) => el('li', { class: i === step ? 'now' : null }, s)));
  $('next-step').hidden = !(step < run.steps.length - 1);
  $('links').replaceChildren(...run.links.map((text, i) => el('button', { type: 'button', on: { click: () => room.send({ t: 'start', id: run.id, link: i }) } }, `Starta i spelet: ${text}`)));
  $('questions').replaceChildren(...run.questions.map((q, i) => {
    const area = el('textarea', { rows: 3, on: { input: (e) => { answers[i] = e.target.value; keepAnswers(run.id, answers); } } });
    area.value = answers[i] ?? '';
    return el('label', {}, q, area);
  }));
  $('extra').value = answers.extra ?? '';
  $('extra').oninput = (e) => { answers.extra = e.target.value; keepAnswers(run.id, answers); };
  for (const b of document.querySelectorAll('[data-result]')) b.setAttribute('aria-pressed', String(b.dataset.result === result));
  renderThumbs();
}

function renderList() {
  $('who').textContent = state ? `${state.tester ?? 'Testare'} · ${state.game ?? ''}` : '';
  const reported = new Set(state?.reported ?? []);
  $('items').replaceChildren(...(state?.items ?? []).map((i) => el('button', {
    type: 'button', class: reported.has(i.id) ? 'done' : null,
    on: { click: () => { $('list-note').textContent = ''; room.send({ t: 'start', id: i.id, link: 0, go: i.links.length > 0 }); } },
  }, el('span', { class: 'id' }, `${i.id}${reported.has(i.id) ? ' · rapporterad' : ''}${i.where ? ` · ${i.where}` : ''}`), el('span', {}, i.title))));
  if (state && !state.items.length) $('items').replaceChildren(el('p', { class: 'muted' }, 'Spelet har inga tester i listan just nu.'));
}

function renderThumbs() {
  $('thumbs').replaceChildren(...thumbs.map((src) => el('img', { src, alt: 'Bild som skickas med' })));
}

$('next-step').addEventListener('click', () => {
  room.send({ t: 'step', step: (state.run.step ?? 0) + 1 });
});
for (const b of document.querySelectorAll('[data-result]')) {
  b.addEventListener('click', () => {
    result = b.dataset.result;
    $('test-note').textContent = '';
    for (const o of document.querySelectorAll('[data-result]')) o.setAttribute('aria-pressed', String(o === b));
  });
}
$('shot').addEventListener('click', () => room.send({ t: 'shot' }));
$('photo').addEventListener('click', () => $('photo-file').click());
$('photo-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!state?.upload) {
    $('test-note').textContent = 'Spelet har inte gett fjärrkontrollen lov att skicka bilder än. Försök igen om en stund.';
    return;
  }
  $('test-note').textContent = 'Skickar bilden …';
  try {
    const blob = await shrinkPicture(file);
    const res = await fetch(`/playtest/image?token=${encodeURIComponent(state.upload)}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob });
    if (!res.ok) throw new Error(String(res.status));
    photos.push((await res.json()).id);
    thumbs.push(URL.createObjectURL(blob));
    $('test-note').textContent = '';
    renderThumbs();
  } catch {
    $('test-note').textContent = 'Bilden kunde inte skickas. Försök igen.';
  }
});

function report(res) {
  const run = state.items.find((i) => i.id === state.run.id) ?? { questions: [] };
  const answers = answersFor(state.run.id);
  return {
    result: res,
    answers: run.questions.map((q, i) => ({ q, a: answers[i] ?? '' })),
    text: answers.extra ?? '',
    images: photos,
  };
}

$('send').addEventListener('click', () => {
  if (!result) {
    $('test-note').textContent = 'Välj Fungerade, Delvis eller Fungerade inte först.';
    return;
  }
  if (sending) return;
  sending = true;
  room.send({ t: 'send', report: report(result) });
  keepAnswers(state.run.id, {});
});
$('restart').addEventListener('click', () => {
  keepAnswers(state.run.id, {});
  room.send({ t: 'restart' });
});
$('cancel').addEventListener('click', () => {
  if (!confirm('Avbryta testet? Det rapporteras som avbrutet.')) return;
  room.send({ t: 'send', report: report('cancelled') });
  keepAnswers(state.run.id, {});
});

$('join').addEventListener('submit', (e) => {
  e.preventDefault();
  connect($('code').value.trim().toUpperCase());
});

const code = codeFromHash();
if (code) connect(code);
else $('join').hidden = false;

/* Форма - тренировки дома. Всё хранится на устройстве, сервера нет. */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const fmtDate = (s, withYear) => { const d = parseYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear || d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`; };
const fmtDur = (sec) => { sec = Math.max(0, Math.round(sec)); return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`; };
const fmtKg = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2];
}

const S = {
  tab: 'home',
  settings: { equip: null, rest: 60, sound: true, goal: null, plan: {} },
  workouts: [], sessions: [], weights: [], photos: [], measures: [], exercises: [],
  active: null,
  wSeg: 'ready', wFocus: 'all', wFit: true,
  pSeg: 'stats', cal: null, metric: 'weight', range: 90,
};

/* ---------- Сохранение ---------- */

// Ошибку записи нельзя глотать: человек должен знать, что данные не легли.
async function store(fn) {
  try { await fn(); return true; }
  catch (e) { console.error(e); toast('Не удалось сохранить. Проверьте свободное место на телефоне.'); return false; }
}
const saveSettings = () => store(() => DB.put('kv', S.settings, 'settings'));

async function load() {
  await DB.open();
  Object.assign(S.settings, (await DB.get('kv', 'settings')) || {});
  S.workouts = await DB.all('workouts');
  S.sessions = (await DB.all('sessions')).sort((a, b) => b.at - a.at);
  S.weights = (await DB.all('weights')).sort((a, b) => a.id.localeCompare(b.id));
  S.photos = (await DB.all('photos')).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  S.measures = (await DB.all('measures')).sort((a, b) => a.d.localeCompare(b.d));
  S.exercises = await DB.all('exercises');
  syncCustomEx();
  S.active = (await DB.get('kv', 'active')) || null;
}

/* ---------- Мелочи интерфейса ---------- */

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

function sheet(html, full) {
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-bg" data-a="closeSheet"></div><div class="sheet${full ? ' full' : ''}"><div class="grab" data-a="closeSheet"></div><div class="sheet-body">${html}</div></div>`;
  $('#sheets').appendChild(el);
  // Принудительный пересчёт вместо requestAnimationFrame: в фоновой вкладке
  // кадры не приходят, и шторка оставалась бы невидимой.
  void el.offsetHeight;
  el.classList.add('on');
  return el;
}
function closeSheet(el) {
  el = el || [...document.querySelectorAll('.sheet-wrap:not(.closing)')].pop();
  if (!el) return;
  el.classList.add('closing');
  el.classList.remove('on');
  setTimeout(() => el.remove(), 240);
}
function closeAllSheets() { document.querySelectorAll('.sheet-wrap:not(.closing)').forEach((el) => closeSheet(el)); }

function choose(title, text, options) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'dialog-wrap';
    el.innerHTML = `<div class="dialog"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${options.map((o, i) => `<button class="btn ${o.kind || 'soft'}" data-k="${i}">${esc(o.label)}</button>`).join('')}</div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      el.remove();
      resolve(options[b.dataset.k].value);
    });
    document.body.appendChild(el);
  });
}
const confirmDel = (title, text) => choose(title, text, [{ label: 'Удалить', value: true, kind: 'danger' }, { label: 'Отмена', value: false }]);

/* ---------- Данные тренировок ---------- */

const exOf = (id) => EX[id] || { id, name: 'Упражнение', g: '', eq: [], t: 'r', tip: '' };
const findWorkout = (id) => PROGRAMS.find((p) => p.id === id) || S.workouts.find((w) => w.id === id);
const myEquip = () => S.settings.equip || [];
const needs = (w) => [...new Set(w.items.flatMap((it) => exOf(it.ex).eq))];
const missing = (w) => needs(w).filter((e) => !myEquip().includes(e));
const itemLabel = (it) => `${it.sets} × ${it.sec ? it.sec + ' сек' : it.reps}`;
function estMin(items) {
  const sec = items.reduce((a, it) => a + it.sets * ((it.sec || 40) + it.rest), 0);
  return Math.max(1, Math.round(sec / 60));
}
function lastKg(exId) {
  for (const s of S.sessions) for (const it of s.items) if (it.ex === exId) {
    const set = [...it.sets].reverse().find((x) => x.kg > 0);
    if (set) return set.kg;
  }
  return 0;
}
function sessionStats(s) {
  let sets = 0, reps = 0, vol = 0;
  for (const it of s.items) for (const x of it.sets) { sets++; reps += x.reps || 0; vol += (x.reps || 0) * (x.kg || 0); }
  return { sets, reps, vol };
}
function streak() {
  const days = new Set(S.sessions.map((s) => s.day));
  const d = new Date();
  if (!days.has(ymd(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function weekDays() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return ymd(x); });
}

/* ---------- Свои упражнения, план, рекорды, замеры ---------- */

// Свои упражнения живут в том же справочнике, что и встроенные: тогда редактор,
// режим тренировки и история работают с ними без отдельных веток.
function syncCustomEx() {
  for (let i = EX_LIST.length - 1; i >= 0; i--) {
    if (EX_LIST[i].custom) { delete EX[EX_LIST[i].id]; EX_LIST.splice(i, 1); }
  }
  for (const e of S.exercises) { EX_LIST.push(e); EX[e.id] = e; }
}

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const todayIdx = () => (new Date().getDay() + 6) % 7;
const planFor = (i) => { const id = (S.settings.plan || {})[i]; return (id && findWorkout(id)) || null; };

const METRICS = {
  weight: { name: 'Вес', unit: 'кг', min: 20, max: 400, hint: 'например 82,4' },
  waist: { name: 'Талия', unit: 'см', min: 30, max: 250, hint: 'например 86' },
  chest: { name: 'Грудь', unit: 'см', min: 30, max: 250, hint: 'например 102' },
  hips: { name: 'Бёдра', unit: 'см', min: 30, max: 250, hint: 'например 98' },
  biceps: { name: 'Бицепс', unit: 'см', min: 10, max: 100, hint: 'например 36,5' },
};
const series = (m) => (m === 'weight'
  ? S.weights.map((w) => ({ d: w.id, v: w.kg }))
  : S.measures.filter((x) => x.m === m).map((x) => ({ d: x.d, v: x.v })));

// Сравнение подходов: сначала вес снаряда, при равном весе - повторы.
const setScore = (x) => (x.sec ? x.sec : (x.kg || 0) * 1000 + (x.reps || 0));
const setLabel = (x) => (x.sec ? `${x.sec} сек` : x.kg ? `${x.reps} × ${fmtKg(x.kg)} кг` : `${x.reps} ${plural(x.reps, ['повтор', 'повтора', 'повторов'])}`);
const bestSet = (sets) => sets.reduce((a, x) => (!a || setScore(x) > setScore(a) ? x : a), null);

// Идём от новых тренировок к старым, и при равном результате дата уходит
// к более ранней: рекорд датируется днём, когда он поставлен впервые.
function records() {
  const map = new Map();
  for (const s of S.sessions) for (const it of s.items) for (const x of it.sets) {
    const r = map.get(it.ex);
    if (!r) map.set(it.ex, { ex: it.ex, best: x, d: s.day });
    else if (setScore(x) >= setScore(r.best)) { r.best = x; r.d = s.day; }
  }
  return [...map.values()];
}
function exHistory(exId) {
  const out = [];
  for (let i = S.sessions.length - 1; i >= 0; i--) {
    const sets = S.sessions[i].items.filter((it) => it.ex === exId).flatMap((it) => it.sets);
    if (sets.length) out.push({ d: S.sessions[i].day, sets });
  }
  return out;
}

/* ---------- Статистика и достижения ---------- */

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const mondayOf = (day) => { const d = parseYmd(day); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };

// Всё считается из записанных тренировок, отдельно нигде не хранится:
// удалил тренировку - статистика и достижения честно пересчитались.
function stats() {
  const perDay = new Map(), perWeek = new Map();
  let sec = 0, sets = 0, reps = 0, vol = 0, early = 0, late = 0, own = 0;
  const programs = new Set(), exs = new Set();
  for (const s of S.sessions) {
    perDay.set(s.day, (perDay.get(s.day) || 0) + 1);
    const wk = mondayOf(s.day);
    perWeek.set(wk, (perWeek.get(wk) || 0) + 1);
    sec += s.durationSec;
    const st = sessionStats(s);
    sets += st.sets; reps += st.reps; vol += st.vol;
    const h = new Date(s.at).getHours();
    if (h < 8) early = 1;
    if (h >= 22) late = 1;
    if (String(s.workoutId).startsWith('c_')) own = 1;
    programs.add(s.workoutId);
    for (const it of s.items) exs.add(it.ex);
  }
  const days = [...perDay.keys()].sort();
  let bestStreak = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev && Math.round((parseYmd(d) - parseYmd(prev)) / 864e5) === 1 ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
    prev = d;
  }
  // Улучшения: сколько раз тренировка побила прежний лучший подход в упражнении.
  let improvements = 0;
  const best = new Map();
  for (let i = S.sessions.length - 1; i >= 0; i--) {
    for (const it of S.sessions[i].items) {
      const b = bestSet(it.sets);
      if (!b) continue;
      const was = best.get(it.ex);
      if (was !== undefined && setScore(b) > was) improvements++;
      if (was === undefined || setScore(b) > was) best.set(it.ex, setScore(b));
    }
  }
  return {
    n: S.sessions.length, sec, sets, reps, vol, early, late, own, perDay, perWeek,
    days: days.length, bestStreak, bestWeek: Math.max(0, ...perWeek.values()),
    programs: programs.size, exs: exs.size, improvements,
  };
}

function achievements(st = stats()) {
  const a = (id, icon, name, desc, cur, target, unit = '') => ({ id, icon, name, desc, unit, cur: Math.min(cur, target), target, done: cur >= target });
  const w = S.weights, goal = S.settings.goal;
  const goalHit = goal && w.length > 1 && (w[0].kg - goal) * (w[w.length - 1].kg - goal) <= 0 ? 1 : 0;
  const pd = S.photos.map((p) => p.date).sort();
  const photoSpan = pd.length > 1 ? Math.round((parseYmd(pd[pd.length - 1]) - parseYmd(pd[0])) / 864e5) : 0;
  return [
    a('w1', '👟', 'Первый шаг', 'Выполнить первую тренировку.', st.n, 1),
    a('w5', '🔆', 'Разогрев', 'Выполнить 5 тренировок.', st.n, 5),
    a('w10', '🔟', 'Десятка', 'Выполнить 10 тренировок.', st.n, 10),
    a('w25', '🥉', 'Четверть сотни', 'Выполнить 25 тренировок.', st.n, 25),
    a('w50', '🥈', 'Полсотни', 'Выполнить 50 тренировок.', st.n, 50),
    a('w100', '🥇', 'Сотня', 'Выполнить 100 тренировок.', st.n, 100),
    a('s3', '🔥', 'Три дня подряд', 'Тренироваться 3 дня подряд.', st.bestStreak, 3),
    a('s7', '🗓️', 'Неделя без пропусков', 'Тренироваться 7 дней подряд.', st.bestStreak, 7),
    a('s14', '⚡', 'Две недели подряд', 'Тренироваться 14 дней подряд.', st.bestStreak, 14),
    a('s30', '🌋', 'Месяц подряд', 'Тренироваться 30 дней подряд.', st.bestStreak, 30),
    a('k3', '📈', 'Три за неделю', 'Сделать 3 тренировки за одну неделю.', st.bestWeek, 3),
    a('k5', '🚀', 'Пять за неделю', 'Сделать 5 тренировок за одну неделю.', st.bestWeek, 5),
    a('v1', '🏋️', 'Первая тонна', 'Поднять в сумме 1000 кг.', st.vol, 1000, 'кг'),
    a('v10', '🦾', 'Десять тонн', 'Поднять в сумме 10 000 кг.', st.vol, 10000, 'кг'),
    a('v50', '🏔️', 'Пятьдесят тонн', 'Поднять в сумме 50 000 кг.', st.vol, 50000, 'кг'),
    a('t10', '⏱️', 'Десять часов', 'Провести на тренировках 10 часов.', st.sec / 3600, 10, 'ч'),
    a('r5', '🎯', 'Расту', 'Пять раз улучшить свой результат в упражнении.', st.improvements, 5),
    a('r20', '🏆', 'Рекордсмен', 'Двадцать раз улучшить свой результат.', st.improvements, 20),
    a('p5', '🧭', 'Разнообразие', 'Попробовать 5 разных тренировок.', st.programs, 5),
    a('e20', '🧩', 'Двадцать упражнений', 'Выполнить 20 разных упражнений.', st.exs, 20),
    a('own', '🛠️', 'По-своему', 'Выполнить тренировку, собранную самостоятельно.', st.own, 1),
    a('early', '🌅', 'Жаворонок', 'Закончить тренировку до 8 утра.', st.early, 1),
    a('late', '🌙', 'Сова', 'Закончить тренировку после 22 часов.', st.late, 1),
    a('bw1', '⚖️', 'На весах', 'Записать вес в первый раз.', w.length, 1),
    a('bw10', '📒', 'Дневник веса', 'Сделать 10 записей веса.', w.length, 10),
    a('goal', '🎉', 'Цель достигнута', 'Дойти до цели по весу, заданной в профиле.', goalHit, 1),
    a('ph1', '📷', 'Первый снимок', 'Добавить первое фото прогресса.', S.photos.length, 1),
    a('ph30', '🎞️', 'Месяц в кадре', 'Иметь снимки с разницей не меньше 30 дней.', photoSpan, 30, 'дн.'),
  ];
}
const earnedIds = () => new Set(achievements().filter((x) => x.done).map((x) => x.id));

function weekBars(st) {
  const cur = parseYmd(mondayOf(today()));
  const weeks = Array.from({ length: 8 }, (_, i) => { const d = new Date(cur); d.setDate(cur.getDate() - (7 - i) * 7); const k = ymd(d); return { k, n: st.perWeek.get(k) || 0 }; });
  const max = Math.max(3, ...weeks.map((x) => x.n));
  const W = 340, H = 120, bw = 26, gap = (W - 8 * bw) / 8, base = H - 22, top = 18;
  return `<svg class="chart bars" viewBox="0 0 ${W} ${H}">${weeks.map((x, i) => {
    const bx = gap / 2 + i * (bw + gap), h = x.n ? Math.max(6, (x.n / max) * (base - top)) : 3;
    const d = parseYmd(x.k);
    return `<rect x="${bx.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="6" class="${x.n ? (i === 7 ? 'bar now' : 'bar') : 'bar zero'}"/>
      ${x.n ? `<text x="${(bx + bw / 2).toFixed(1)}" y="${(base - h - 5).toFixed(1)}" text-anchor="middle" class="lbl val">${x.n}</text>` : ''}
      <text x="${(bx + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="lbl">${d.getDate()}.${pad(d.getMonth() + 1)}</text>`;
  }).join('')}</svg>`;
}

function vStats() {
  const st = stats();
  const now = new Date();
  const cal = S.cal || { y: now.getFullYear(), m: now.getMonth() };
  const offset = (new Date(cal.y, cal.m, 1).getDay() + 6) % 7;
  const dim = new Date(cal.y, cal.m + 1, 0).getDate();
  const isNow = cal.y === now.getFullYear() && cal.m === now.getMonth();
  let cells = '<span></span>'.repeat(offset), monthN = 0;
  for (let d = 1; d <= dim; d++) {
    const key = `${cal.y}-${pad(cal.m + 1)}-${pad(d)}`;
    const n = st.perDay.get(key) || 0;
    monthN += n;
    const cls = `cd${key === today() ? ' today' : ''}${key > today() ? ' future' : ''}`;
    cells += n ? `<button class="${cls} on" data-a="calDay" data-d="${key}">${d}${n > 1 ? `<sup>${n}</sup>` : ''}</button>` : `<span class="${cls}">${d}</span>`;
  }
  const time = st.sec < 3600 ? `${Math.round(st.sec / 60)}<small> мин</small>` : `${fmtKg(st.sec / 3600)}<small> ч</small>`;
  const vol = st.vol >= 1000 ? `${fmtKg(st.vol / 1000)}<small> т</small>` : `${Math.round(st.vol)}<small> кг</small>`;
  const cur = streak();
  const ach = achievements(st).sort((x, y) => (y.done - x.done) || (y.cur / y.target - x.cur / x.target));
  const got = ach.filter((x) => x.done).length;
  return `
    <div class="tiles">
      <div class="card tile"><b>${st.n}</b><span>${plural(st.n, ['тренировка', 'тренировки', 'тренировок'])} всего</span></div>
      <div class="card tile"><b>${time}</b><span>общее время</span></div>
      <div class="card tile"><b>${st.days}</b><span>${plural(st.days, ['активный день', 'активных дня', 'активных дней'])}</span></div>
      <div class="card tile"><b>${cur}<small> 🔥</small></b><span>${plural(cur, ['день', 'дня', 'дней'])} подряд сейчас</span></div>
      <div class="card tile"><b>${st.bestStreak}</b><span>лучшая серия, ${plural(st.bestStreak, ['день', 'дня', 'дней'])}</span></div>
      <div class="card tile"><b>${vol}</b><span>поднято всего</span></div>
    </div>

    <div class="card">
      <div class="cal-head"><button class="x" data-a="calNav" data-d="-1">‹</button><div><b>${MONTH_NAMES[cal.m]} ${cal.y}</b><div class="muted">${monthN ? `${monthN} ${plural(monthN, ['тренировка', 'тренировки', 'тренировок'])}` : 'тренировок нет'}</div></div><button class="x" data-a="calNav" data-d="1" ${isNow ? 'disabled' : ''}>›</button></div>
      <div class="cal"><i>П</i><i>В</i><i>С</i><i>Ч</i><i>П</i><i>С</i><i>В</i>${cells}</div>
    </div>

    <h2 class="sec">Тренировок по неделям</h2>
    <div class="card">${weekBars(st)}<p class="hint">Последние восемь недель, под столбцом - понедельник.</p></div>

    <h2 class="sec">Достижения <span class="muted">${got} из ${ach.length}</span></h2>
    <div class="ach-grid">${ach.map((x) => `<button class="ach${x.done ? ' done' : ''}" data-a="achOpen" data-id="${x.id}"><i>${x.icon}</i><b>${x.name}</b>${x.done ? '<span class="got">получено</span>' : `<span class="bar"><u style="width:${Math.round((x.cur / x.target) * 100)}%"></u></span>`}</button>`).join('')}</div>

    ${S.sessions.length ? `<h2 class="sec">Последние тренировки</h2>${S.sessions.slice(0, 5).map(sessionRow).join('')}${S.sessions.length > 5 ? '<button class="btn soft block" data-a="allHistory">Вся история</button>' : ''}` : ''}`;
}

/* ---------- Экран «Сегодня» ---------- */

function suggestion() {
  const fit = PROGRAMS.filter((p) => !missing(p).length && p.focus !== 'stretch');
  const pool = fit.length ? fit : PROGRAMS;
  const lastId = S.sessions[0] && S.sessions[0].workoutId;
  const recent = new Set(S.sessions.slice(0, 3).map((s) => s.workoutId));
  return pool.find((p) => !recent.has(p.id)) || pool.find((p) => p.id !== lastId) || pool[0];
}

function heroCard(w, title) {
  return `<h2 class="sec">${title}</h2>
  <div class="card hero">
    <div class="wc-top">${w.ready ? `<span class="tag">${FOCUS[w.focus]}</span><span class="tag">${LEVELS[w.level]}</span>` : '<span class="tag">Своя</span>'}<span class="muted">~${estMin(w.items)} мин</span></div>
    <h3>${esc(w.name)}</h3>
    ${w.desc ? `<p class="muted">${esc(w.desc)}</p>` : ''}
    <div class="row">
      <button class="btn primary grow" data-a="startW" data-id="${w.id}">Начать</button>
      <button class="btn soft" data-a="openW" data-id="${w.id}">Состав</button>
    </div>
  </div>`;
}

function vHome() {
  const now = new Date();
  const week = weekDays();
  const done = new Set(S.sessions.map((s) => s.day));
  const wk = S.sessions.filter((s) => s.day >= week[0] && s.day <= week[6]);
  const wkMin = Math.round(wk.reduce((a, s) => a + s.durationSec, 0) / 60);
  const st = streak();
  const lastW = S.weights[S.weights.length - 1];
  const firstW = S.weights[0];
  const delta = lastW && firstW && S.weights.length > 1 ? lastW.kg - firstW.kg : null;

  const ti = todayIdx();
  const plan = week.map((_, i) => planFor(i));
  const hasPlan = plan.some(Boolean);
  const doneToday = done.has(today());
  let next = '';
  for (let k = 1; k <= 7 && !next; k++) {
    const w = plan[(ti + k) % 7];
    if (w) next = `${k === 1 ? 'завтра' : DAY_NAMES[(ti + k) % 7].toLowerCase()} - ${w.name}`;
  }
  let main;
  if (plan[ti] && !doneToday) main = heroCard(plan[ti], 'По плану на сегодня');
  else if (hasPlan) {
    main = `<h2 class="sec">${doneToday ? 'На сегодня всё' : 'Сегодня отдых'}</h2>
    <div class="card"><p>${doneToday ? 'Тренировка выполнена.' : 'По плану сегодня тренировки нет.'}${next ? ` Следующая: ${esc(next)}.` : ''}</p>
    <button class="btn soft block mt" data-a="tab" data-t="workouts">Выбрать другую тренировку</button></div>`;
  } else main = heroCard(suggestion(), 'Предложение на сегодня');
  const missed = plan.map((w, i) => (w && i < ti && !done.has(week[i]) ? { w, i } : null)).filter(Boolean);

  return `
  <header class="top"><div class="eyebrow">${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}</div><h1>Сегодня</h1></header>

  ${S.active ? `<button class="card resume" data-a="resume"><div><div class="eyebrow dark">Не закончена</div><h3>${esc(S.active.name)}</h3></div><span class="pill dark">Продолжить</span></button>` : ''}

  <div class="card">
    <div class="week">
      ${week.map((d, i) => `<div class="wd${done.has(d) ? ' done' : ''}${d === today() ? ' today' : ''}${plan[i] && !done.has(d) ? (i < ti ? ' miss' : ' plan') : ''}"><span>${'ПВСЧПСВ'[i]}</span><i>${done.has(d) ? '✓' : parseYmd(d).getDate()}</i></div>`).join('')}
    </div>
    <button class="link" data-a="planOpen">${hasPlan ? 'Изменить план на неделю' : 'Составить план на неделю'}</button>
  </div>

  <div class="tiles">
    <div class="card tile"><b>${wk.length}</b><span>${plural(wk.length, ['тренировка', 'тренировки', 'тренировок'])} за неделю</span></div>
    <div class="card tile"><b>${st}</b><span>${plural(st, ['день', 'дня', 'дней'])} подряд</span></div>
    <div class="card tile"><b>${wkMin}</b><span>${plural(wkMin, ['минута', 'минуты', 'минут'])} за неделю</span></div>
  </div>

  ${main}

  ${missed.length ? `<h2 class="sec">Пропущено на этой неделе</h2>${missed.map(({ w, i }) => `<button class="card srow" data-a="openW" data-id="${w.id}"><div><h4>${esc(w.name)}</h4><div class="muted">${DAY_NAMES[i].toLowerCase()}</div></div><span class="chev">›</span></button>`).join('')}` : ''}

  <h2 class="sec">Вес</h2>
  <button class="card weight-mini" data-a="goWeight">
    ${lastW
      ? `<div><b>${fmtKg(lastW.kg)}</b> кг<div class="muted">${fmtDate(lastW.id)}</div></div>
         ${delta !== null ? `<span class="pill ${delta <= 0 ? 'good' : ''}">${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmtKg(Math.abs(delta))} кг с начала</span>` : '<span class="muted">первая запись</span>'}`
      : '<div><b>Записать вес</b><div class="muted">Чтобы видеть, как он меняется</div></div><span class="pill">+</span>'}
  </button>

  ${S.sessions.length ? `<h2 class="sec">Последние тренировки</h2>${S.sessions.slice(0, 3).map(sessionRow).join('')}` : ''}`;
}

function openPlan() {
  const opt = (w, cur) => `<option value="${w.id}"${cur === w.id ? ' selected' : ''}>${esc(w.name)} · ~${estMin(w.items)} мин</option>`;
  sheet(`
    <h2>План на неделю</h2>
    <p class="muted">Выберите тренировку на каждый день. Дни без тренировки - отдых. Напоминаний программа не присылает: план виден на экране «Сегодня».</p>
    ${DAY_NAMES.map((n, i) => {
      const cur = (S.settings.plan || {})[i] || '';
      return `<label class="field"><span>${n}</span><select class="inp" data-c="planSel" data-k="${i}">
        <option value="">Отдых</option>
        ${S.workouts.length ? `<optgroup label="Мои">${S.workouts.map((w) => opt(w, cur)).join('')}</optgroup>` : ''}
        <optgroup label="Готовые">${PROGRAMS.map((w) => opt(w, cur)).join('')}</optgroup>
      </select></label>`;
    }).join('')}
    <div class="sticky-actions"><button class="btn primary block" data-a="planDone">Готово</button></div>`, true);
}

function sessionRow(s) {
  const st = sessionStats(s);
  return `<button class="card srow" data-a="openS" data-id="${s.id}">
    <div><h4>${esc(s.name)}</h4><div class="muted">${fmtDate(s.day)} · ${Math.max(1, Math.round(s.durationSec / 60))} мин · ${st.sets} ${plural(st.sets, ['подход', 'подхода', 'подходов'])}</div></div><span class="chev">›</span>
  </button>`;
}

/* ---------- Экран «Тренировки» ---------- */

const eqTags = (w) => {
  const n = needs(w);
  if (!n.length) return '<span class="tag ghost">Без инвентаря</span>';
  return n.map((e) => `<span class="tag ghost${myEquip().includes(e) ? '' : ' miss'}">${EQUIP[e]}</span>`).join('');
};

function wCard(w) {
  return `<button class="card wcard" data-a="openW" data-id="${w.id}">
    <div class="wc-top">${w.ready ? `<span class="tag">${FOCUS[w.focus]}</span><span class="tag">${LEVELS[w.level]}</span>` : '<span class="tag">Своя</span>'}<span class="muted">~${estMin(w.items)} мин</span></div>
    <h3>${esc(w.name)}</h3>
    ${w.desc ? `<p class="muted">${esc(w.desc)}</p>` : `<p class="muted">${w.items.length} ${plural(w.items.length, ['упражнение', 'упражнения', 'упражнений'])}</p>`}
    <div class="tags">${eqTags(w)}</div>
  </button>`;
}

function vWorkouts() {
  let body;
  if (S.wSeg === 'ready') {
    let list = PROGRAMS.filter((p) => S.wFocus === 'all' || p.focus === S.wFocus);
    const hidden = list.filter((p) => missing(p).length).length;
    if (S.wFit) list = list.filter((p) => !missing(p).length);
    body = `
      <div class="chips">${[['all', 'Все'], ...Object.entries(FOCUS)].map(([k, v]) => `<button class="chip${S.wFocus === k ? ' on' : ''}" data-a="wFocus" data-k="${k}">${v}</button>`).join('')}</div>
      <button class="switch-row" data-a="wFit"><span>Только под мой инвентарь</span><i class="sw${S.wFit ? ' on' : ''}"></i></button>
      ${list.map(wCard).join('') || '<div class="empty">Под ваш инвентарь здесь ничего нет. Отметьте в профиле, что у вас есть, или выключите отбор.</div>'}
      ${S.wFit && hidden ? `<p class="hint">Скрыто ${hidden}: для них нужен инвентарь, которого нет в профиле.</p>` : ''}`;
  } else {
    body = `
      <button class="btn primary block" data-a="newW">Создать тренировку</button>
      ${S.workouts.map(wCard).join('') || '<div class="empty">Своих тренировок пока нет. Соберите из списка упражнений или возьмите готовую и измените под себя.</div>'}`;
  }
  return `
  <header class="top"><h1>Тренировки</h1></header>
  <div class="seg"><button class="${S.wSeg === 'ready' ? 'on' : ''}" data-a="wSeg" data-k="ready">Готовые</button><button class="${S.wSeg === 'mine' ? 'on' : ''}" data-a="wSeg" data-k="mine">Мои</button></div>
  ${body}`;
}

function openWorkout(id) {
  const w = findWorkout(id);
  if (!w) return;
  const miss = missing(w);
  sheet(`
    <div class="wc-top">${w.ready ? `<span class="tag">${FOCUS[w.focus]}</span><span class="tag">${LEVELS[w.level]}</span>` : '<span class="tag">Своя</span>'}<span class="muted">~${estMin(w.items)} мин</span></div>
    <h2>${esc(w.name)}</h2>
    ${w.desc ? `<p class="muted">${esc(w.desc)}</p>` : ''}
    ${miss.length ? `<div class="warn">Нужно: ${miss.map((e) => EQUIP[e].toLowerCase()).join(', ')}. В вашем профиле этого нет.</div>` : ''}
    <div class="list">
      ${w.items.map((it) => { const ex = exOf(it.ex); return `<details class="li"><summary><div><b>${esc(ex.name)}</b><div class="muted">${ex.g}${it.rest ? ` · отдых ${it.rest} сек` : ''}</div></div><span class="qty">${itemLabel(it)}</span></summary><p>${esc(ex.tip)}</p></details>`; }).join('')}
    </div>
    <div class="sticky-actions">
      <button class="btn primary block" data-a="startW" data-id="${w.id}">Начать тренировку</button>
      ${w.ready
        ? `<button class="btn soft block" data-a="copyW" data-id="${w.id}">Изменить под себя</button>`
        : `<div class="row"><button class="btn soft grow" data-a="editW" data-id="${w.id}">Изменить</button><button class="btn danger-soft" data-a="delW" data-id="${w.id}">Удалить</button></div>`}
    </div>`, true);
}

/* ---------- Редактор своей тренировки ---------- */

let E = null;

function openEditor(w, asNew) {
  E = {
    id: w && !asNew ? w.id : null,
    name: w ? (asNew ? `${w.name} (моя)` : w.name) : '',
    items: w ? w.items.map((x) => ({ ...x })) : [],
  };
  E.el = sheet('<div id="ed"></div>', true);
  drawEditor();
}

const stepper = (label, val, attrs) => `<div class="stp"><span>${label}</span><div><button data-d="-1" ${attrs}>−</button><b>${val}</b><button data-d="1" ${attrs}>+</button></div></div>`;

function drawEditor() {
  $('#ed', E.el).innerHTML = `
    <h2>${E.id ? 'Изменить тренировку' : 'Новая тренировка'}</h2>
    <input class="inp" data-i="edName" placeholder="Название" maxlength="60" value="${esc(E.name)}">
    ${E.items.map((it, i) => {
      const ex = exOf(it.ex);
      return `<div class="ed-item">
        <div class="ed-head"><b>${esc(ex.name)}</b><span><button data-a="edMove" data-idx="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button data-a="edMove" data-idx="${i}" data-d="1" ${i === E.items.length - 1 ? 'disabled' : ''}>↓</button><button data-a="edDel" data-idx="${i}">✕</button></span></div>
        <div class="ed-steps">
          ${stepper('Подходы', it.sets, `data-a="edStep" data-idx="${i}" data-f="sets"`)}
          ${it.sec ? stepper('Секунды', it.sec, `data-a="edStep" data-idx="${i}" data-f="sec"`) : stepper('Повторы', it.reps, `data-a="edStep" data-idx="${i}" data-f="reps"`)}
          ${stepper('Отдых', it.rest, `data-a="edStep" data-idx="${i}" data-f="rest"`)}
        </div>
      </div>`;
    }).join('') || '<div class="empty">Добавьте первое упражнение.</div>'}
    <button class="btn soft block" data-a="edAdd">Добавить упражнение</button>
    <div class="sticky-actions"><button class="btn primary block" data-a="edSave">Сохранить</button></div>`;
}

let PK = null;
function openPicker() {
  PK = { q: '', g: 'Все', fit: true };
  PK.el = sheet(`
    <h2>Упражнения</h2>
    <input class="inp" data-i="pkQ" placeholder="Поиск" type="search">
    <div class="chips" id="pk-chips"></div>
    <button class="switch-row" data-a="pkFit"><span>Только под мой инвентарь</span><i class="sw on" id="pk-sw"></i></button>
    <button class="btn soft block" data-a="exNew">Добавить своё упражнение</button>
    <div class="list" id="pk-list"></div>`, true);
  drawPicker();
}
function drawPicker() {
  $('#pk-chips', PK.el).innerHTML = ['Все', ...GROUPS].map((g) => `<button class="chip${PK.g === g ? ' on' : ''}" data-a="pkG" data-k="${g}">${g}</button>`).join('');
  $('#pk-sw', PK.el).classList.toggle('on', PK.fit);
  const q = PK.q.trim().toLowerCase();
  const list = EX_LIST.filter((e) => !e.hidden
    && (PK.g === 'Все' || e.g === PK.g)
    && (!q || e.name.toLowerCase().includes(q))
    && (!PK.fit || e.eq.every((x) => myEquip().includes(x))));
  // Свои - первыми: человек только что завёл упражнение и ищет его глазами.
  list.sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0));
  $('#pk-list', PK.el).innerHTML = list.map((e) => {
    const n = E.items.filter((it) => it.ex === e.id).length;
    return `<div class="li pick" data-a="pkAdd" data-id="${e.id}"><div><b>${esc(e.name)}</b>${e.custom ? ' <span class="tag ghost">своё</span>' : ''}<div class="muted">${e.g}${e.eq.length ? ' · ' + e.eq.map((x) => EQUIP[x].toLowerCase()).join(', ') : ''}</div></div><span class="row">${e.custom ? `<button class="x" data-a="exEdit" data-id="${e.id}">✎</button>` : ''}<span class="qty">${n ? '✓ ' + n : '+'}</span></span></div>`;
  }).join('') || '<div class="empty">Ничего не нашлось.</div>';
}

let XF = null;
function openExForm(ex) {
  XF = ex ? { ...ex, eq: [...ex.eq] } : { id: null, name: '', g: PK && PK.g !== 'Все' ? PK.g : 'Грудь', eq: [], t: 'r', w: 0, tip: '' };
  XF.el = sheet('<div id="xf"></div>', true);
  drawExForm();
}
function drawExForm() {
  $('#xf', XF.el).innerHTML = `
    <h2>${XF.id ? 'Изменить упражнение' : 'Своё упражнение'}</h2>
    <input class="inp" data-i="xfName" placeholder="Название" maxlength="60" value="${esc(XF.name)}">
    <div class="field"><span>Группа</span><div class="chips wrap">${GROUPS.map((g) => `<button class="chip${XF.g === g ? ' on' : ''}" data-a="xfG" data-k="${g}">${g}</button>`).join('')}</div></div>
    <div class="field"><span>Как считать</span><div class="seg"><button class="${XF.t === 'r' ? 'on' : ''}" data-a="xfT" data-k="r">Повторы</button><button class="${XF.t === 't' ? 'on' : ''}" data-a="xfT" data-k="t">Время</button></div></div>
    ${XF.t === 'r' ? `<button class="switch-row" data-a="xfW"><span>Записывать вес снаряда</span><i class="sw${XF.w ? ' on' : ''}"></i></button>` : ''}
    <div class="field"><span>Нужен инвентарь</span><div class="chips wrap">${Object.entries(EQUIP).map(([k, v]) => `<button class="chip${XF.eq.includes(k) ? ' on' : ''}" data-a="xfEq" data-k="${k}">${v}</button>`).join('')}</div></div>
    <textarea class="inp" data-i="xfTip" placeholder="Заметка о технике (необязательно)" rows="3" maxlength="400">${esc(XF.tip)}</textarea>
    <div class="sticky-actions">
      <button class="btn primary block" data-a="xfSave">Сохранить</button>
      ${XF.id ? '<button class="btn danger-soft block" data-a="xfDel">Убрать из списка</button>' : ''}
    </div>`;
}
async function saveCustomEx(rec) {
  if (!(await store(() => DB.put('exercises', rec)))) return false;
  S.exercises = S.exercises.filter((e) => e.id !== rec.id).concat(rec);
  syncCustomEx();
  closeSheet(XF.el);
  if (PK && PK.el.isConnected) drawPicker();
  if (E && E.el.isConnected) drawEditor();
  return true;
}

/* ---------- Режим тренировки ---------- */

let P = null;
let tickTimer = null;
let audio = null;
let wakeLock = null;
const RING = 2 * Math.PI * 110;

function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (e) { audio = null; }
}
function beep(freq, dur, when = 0) {
  if (!audio || !S.settings.sound) return;
  const t = audio.currentTime + when;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const beepEnd = () => { beep(880, 0.18); beep(880, 0.18, 0.25); beep(1175, 0.35, 0.5); };

async function keepAwake(on) {
  try {
    if (on && navigator.wakeLock && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* экран погаснет как обычно - на тренировку это не влияет */ }
}

const elapsed = () => (P.finalElapsed != null ? P.finalElapsed : P.elapsedBase + (Date.now() - P.resumedAt) / 1000);

function persistActive() {
  const snap = { ...P, elapsedBase: elapsed(), resumedAt: null, t: null };
  S.active = snap;
  return store(() => DB.put('kv', snap, 'active'));
}
async function clearActive() { S.active = null; await store(() => DB.del('kv', 'active')); }

function setupWork() {
  const it = P.items[P.i], ex = exOf(it.ex);
  P.phase = 'work';
  if (it.sec) {
    P.t = { total: it.sec, left: it.sec, endsAt: null };
    P.cur = null;
  } else {
    P.t = null;
    const prev = P.log[P.i][P.log[P.i].length - 1];
    P.cur = { reps: it.reps, kg: ex.w ? (prev ? prev.kg : lastKg(it.ex)) : 0 };
  }
}

function startWorkout(w) {
  unlockAudio();
  P = {
    workoutId: w.id, name: w.name,
    items: w.items.map((x) => ({ ...x })),
    i: 0, s: 0, log: w.items.map(() => []),
    elapsedBase: 0, resumedAt: Date.now(), finalElapsed: null,
  };
  setupWork();
  openPlayer();
  persistActive();
}

function resumeWorkout() {
  unlockAudio();
  P = { ...S.active, resumedAt: Date.now(), finalElapsed: null };
  // Если программу закрыли во время отдыха, возвращаемся уже к следующему подходу.
  if (P.phase === 'rest' && P.next) { P.i = P.next.i; P.s = P.next.s; }
  setupWork();
  openPlayer();
}

function openPlayer() {
  closeAllSheets();
  $('#player').hidden = false;
  document.body.classList.add('playing');
  keepAwake(true);
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 200);
  drawPlayer();
}
function closePlayer() {
  clearInterval(tickTimer);
  keepAwake(false);
  P = null;
  $('#player').hidden = true;
  $('#player').innerHTML = '';
  document.body.classList.remove('playing');
  render();
}

function record(set) {
  P.log[P.i].push(set);
  advance(false);
}

function advance(skipExercise) {
  const it = P.items[P.i];
  let ni = P.i, ns = P.s + 1;
  if (skipExercise || ns >= it.sets) { ni++; ns = 0; }
  if (ni >= P.items.length) return finish();
  P.next = { i: ni, s: ns };
  if (!skipExercise && it.rest > 0) {
    P.phase = 'rest';
    P.t = { total: it.rest, left: it.rest, endsAt: Date.now() + it.rest * 1000 };
    drawPlayer();
    persistActive();
  } else goNext();
}

function goNext() {
  P.i = P.next.i; P.s = P.next.s;
  setupWork();
  drawPlayer();
  persistActive();
}

async function finish() {
  const items = P.items.map((it, i) => ({ ex: it.ex, sets: P.log[i] })).filter((x) => x.sets.length);
  P.finalElapsed = elapsed();
  P.t = null;
  if (!items.length) {
    await clearActive();
    closePlayer();
    toast('Ни одного подхода не выполнено - тренировка не записана.');
    return;
  }
  const session = { id: uid(), at: Date.now(), day: today(), name: P.name, workoutId: P.workoutId, durationSec: Math.round(P.finalElapsed), items };
  // Рекордом считаем только улучшение прежнего результата: иначе первая же
  // тренировка состояла бы из одних «рекордов».
  const prevBest = new Map(records().map((r) => [r.ex, r.best]));
  P.records = items.map((it) => {
    const was = prevBest.get(it.ex), now = bestSet(it.sets);
    return was && setScore(now) > setScore(was) ? { ex: it.ex, best: now } : null;
  }).filter(Boolean);
  const ok = await store(() => DB.put('sessions', session));
  const hadAch = earnedIds();
  if (ok) { S.sessions.unshift(session); await clearActive(); }
  P.achv = ok ? achievements().filter((x) => x.done && !hadAch.has(x.id)) : [];
  P.phase = 'done';
  P.session = session;
  P.saved = ok;
  beepEnd();
  drawPlayer();
}

function tick() {
  if (!P) return;
  const el = $('#p-elapsed');
  if (el) el.textContent = fmtDur(elapsed());
  if (!P.t || !P.t.endsAt) return;
  const left = Math.max(0, (P.t.endsAt - Date.now()) / 1000);
  P.t.left = left;
  paintRing();
  const c = Math.ceil(left);
  if (c <= 3 && c > 0 && c !== P.t.lastBeep) { P.t.lastBeep = c; beep(660, 0.09); }
  if (left <= 0) {
    P.t.endsAt = null;
    beepEnd();
    if (P.phase === 'rest') goNext();
    else record({ sec: P.t.total });
  }
}

function paintRing() {
  const time = $('#p-time'), ring = $('#p-ring');
  if (!time || !ring || !P.t) return;
  time.textContent = fmtDur(Math.ceil(P.t.left));
  ring.style.strokeDashoffset = RING * (1 - P.t.left / P.t.total);
}

const ringHtml = (cls) => `<div class="ring ${cls}"><svg viewBox="0 0 240 240"><circle cx="120" cy="120" r="110" class="ring-bg"/><circle cx="120" cy="120" r="110" id="p-ring" class="ring-fg" stroke-dasharray="${RING}" transform="rotate(-90 120 120)"/></svg><div id="p-time"></div></div>`;

function drawPlayer() {
  const root = $('#player');
  if (P.phase === 'done') {
    const st = sessionStats(P.session);
    root.innerHTML = `<div class="p-body done">
      <div class="done-mark">✓</div>
      <h2>Тренировка завершена</h2>
      <p class="muted">${esc(P.name)}</p>
      ${P.saved ? '' : '<div class="warn">Записать тренировку не удалось - на телефоне не хватило места.</div>'}
      ${P.records.length ? `<div class="card recs"><div class="eyebrow">${P.records.length > 1 ? 'Новые рекорды' : 'Новый рекорд'}</div>${P.records.map((r) => `<div><b>${esc(exOf(r.ex).name)}</b><span class="qty">${setLabel(r.best)}</span></div>`).join('')}</div>` : ''}
      ${P.achv.length ? `<div class="card recs"><div class="eyebrow">${P.achv.length > 1 ? 'Новые достижения' : 'Новое достижение'}</div>${P.achv.map((x) => `<div><b>${x.icon} ${x.name}</b></div>`).join('')}</div>` : ''}
      <div class="tiles">
        <div class="card tile"><b>${fmtDur(P.session.durationSec)}</b><span>время</span></div>
        <div class="card tile"><b>${st.sets}</b><span>${plural(st.sets, ['подход', 'подхода', 'подходов'])}</span></div>
        <div class="card tile"><b>${st.vol ? fmtKg(st.vol) : st.reps}</b><span>${st.vol ? 'кг поднято' : plural(st.reps, ['повтор', 'повтора', 'повторов'])}</span></div>
      </div>
      <button class="btn primary block big" data-a="pFinish">Готово</button>
    </div>`;
    return;
  }

  const totalSets = P.items.reduce((a, it) => a + it.sets, 0);
  const doneSets = P.items.slice(0, P.i).reduce((a, it) => a + it.sets, 0) + P.s + (P.phase === 'rest' ? 1 : 0);
  const top = `<div class="p-top"><button class="p-x" data-a="pClose">✕</button><div class="p-bar"><i style="width:${Math.round((doneSets / totalSets) * 100)}%"></i></div><span id="p-elapsed">${fmtDur(elapsed())}</span></div>`;

  if (P.phase === 'rest') {
    const nx = P.items[P.next.i], nex = exOf(nx.ex);
    root.innerHTML = `${top}<div class="p-body">
      <div class="eyebrow">Отдых</div>
      ${ringHtml('rest')}
      <div class="row center"><button class="btn soft" data-a="pRestAdd">+15 сек</button><button class="btn soft" data-a="pRestSkip">Пропустить</button></div>
      <div class="card next"><div class="eyebrow">Дальше</div><b>${esc(nex.name)}</b><div class="muted">подход ${P.next.s + 1} из ${nx.sets} · ${nx.sec ? nx.sec + ' сек' : nx.reps + ' ' + plural(nx.reps, ['повтор', 'повтора', 'повторов'])}</div></div>
    </div>`;
    paintRing();
    return;
  }

  const it = P.items[P.i], ex = exOf(it.ex);
  const prev = P.log[P.i].map((x, k) => `<span class="tag ghost">${k + 1}: ${x.sec ? x.sec + ' сек' : x.reps + (x.kg ? ' × ' + fmtKg(x.kg) + ' кг' : '')}</span>`).join('');
  const head = `
    <div class="eyebrow">${ex.g} · упражнение ${P.i + 1} из ${P.items.length}</div>
    <h2>${esc(ex.name)}</h2>
    <div class="p-set">Подход ${P.s + 1} из ${it.sets}</div>
    ${prev ? `<div class="tags center">${prev}</div>` : ''}`;
  const tip = ex.tip ? `<details class="tip"><summary>Как выполнять</summary><p>${esc(ex.tip)}</p></details>` : '';

  if (it.sec) {
    const running = !!P.t.endsAt;
    const started = running || P.t.left < P.t.total;
    root.innerHTML = `${top}<div class="p-body">${head}
      ${ringHtml('work')}
      ${tip}
      <div class="p-actions">
        <button class="btn primary block big" data-a="pStart">${running ? 'Пауза' : started ? 'Продолжить' : 'Старт'}</button>
        <button class="btn ghost block" data-a="pSkip">Пропустить упражнение</button>
      </div></div>`;
    paintRing();
  } else {
    root.innerHTML = `${top}<div class="p-body">${head}
      <div class="p-inputs">
        <div class="big-stp"><span>Повторы</span><div><button data-a="pStep" data-f="reps" data-d="-1">−</button><input data-i="pReps" inputmode="numeric" value="${P.cur.reps}"><button data-a="pStep" data-f="reps" data-d="1">+</button></div></div>
        ${ex.w ? `<div class="big-stp"><span>Вес, кг</span><div><button data-a="pStep" data-f="kg" data-d="-1">−</button><input data-i="pKg" inputmode="decimal" value="${fmtKg(P.cur.kg)}"><button data-a="pStep" data-f="kg" data-d="1">+</button></div></div>` : ''}
      </div>
      ${tip}
      <div class="p-actions">
        <button class="btn primary block big" data-a="pDone">Подход выполнен</button>
        <button class="btn ghost block" data-a="pSkip">Пропустить упражнение</button>
      </div></div>`;
  }
}

/* ---------- Экран «Прогресс» ---------- */

function lineChart(all, o = {}) {
  const from = o.range ? ymd(new Date(Date.now() - o.range * 864e5)) : '';
  const pts = all.filter((p) => p.d >= from);
  if (!pts.length) return `<div class="empty small">${all.length ? 'За этот период записей нет.' : (o.empty || 'Здесь появится график.')}</div>`;
  const W = 340, H = 170, L = 8, R = 8, T = 16, B = 26;
  const goal = o.goal;
  const vals = pts.map((p) => p.v).concat(goal ? [goal] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
  const t0 = parseYmd(pts[0].d).getTime(), t1 = parseYmd(pts[pts.length - 1].d).getTime();
  const x = (p) => (t1 === t0 ? W / 2 : L + ((parseYmd(p.d).getTime() - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = pts.length > 1 ? `${line} L${x(pts[pts.length - 1]).toFixed(1)} ${H - B} L${x(pts[0]).toFixed(1)} ${H - B} Z` : '';
  const last = pts[pts.length - 1];
  const hiP = pts.reduce((a, p) => (p.v > a.v ? p : a)), loP = pts.reduce((a, p) => (p.v < a.v ? p : a));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${goal ? `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${W - R}" y="${y(goal) - 5}" text-anchor="end" class="lbl">цель ${fmtKg(goal)}</text>` : ''}
    ${area ? `<path d="${area}" fill="url(#wg)"/>` : ''}
    ${pts.length > 1 ? `<path d="${line}" class="line"/>` : ''}
    ${pts.length <= 40 ? pts.map((p) => `<circle cx="${x(p).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5" class="dot"/>`).join('') : ''}
    <circle cx="${x(last).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="5" class="dot last"/>
    ${pts.length > 1 && hiP.v !== loP.v ? `<text x="${clamp(x(hiP), 22, W - 22).toFixed(1)}" y="${(y(hiP.v) - 8).toFixed(1)}" text-anchor="middle" class="lbl val">${fmtKg(hiP.v)}</text><text x="${clamp(x(loP), 22, W - 22).toFixed(1)}" y="${(y(loP.v) + 16).toFixed(1)}" text-anchor="middle" class="lbl val">${fmtKg(loP.v)}</text>` : ''}
    <text x="${L}" y="${H - 6}" class="lbl">${fmtDate(pts[0].d)}</text>
    ${pts.length > 1 ? `<text x="${W - R}" y="${H - 6}" text-anchor="end" class="lbl">${fmtDate(last.d)}</text>` : ''}
  </svg>`;
}

const thumbUrls = new Map();
function thumbUrl(p) {
  if (!thumbUrls.has(p.id)) thumbUrls.set(p.id, URL.createObjectURL(p.thumb));
  return thumbUrls.get(p.id);
}

function vProgress() {
  let body;
  if (S.pSeg === 'body') {
    const m = METRICS[S.metric], pts = series(S.metric);
    const last = pts[pts.length - 1], first = pts[0];
    const delta = pts.length > 1 ? last.v - first.v : null;
    const goal = S.metric === 'weight' ? S.settings.goal : null;
    body = `
      <div class="chips">${Object.entries(METRICS).map(([k, x]) => `<button class="chip${S.metric === k ? ' on' : ''}" data-a="metric" data-k="${k}">${x.name}</button>`).join('')}</div>
      <div class="card">
        <div class="w-head">
          <div><div class="eyebrow">Сейчас</div><div class="w-big">${last ? fmtKg(last.v) : '-'}<small> ${m.unit}</small></div></div>
          <div class="w-side">
            ${delta !== null ? `<div><b>${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmtKg(Math.abs(delta))} ${m.unit}</b><span class="muted"> с ${fmtDate(first.d)}</span></div>` : ''}
            ${goal && last ? `<div class="muted">до цели ${fmtKg(Math.abs(last.v - goal))} кг</div>` : ''}
          </div>
        </div>
        ${lineChart(pts, { range: S.range, goal, empty: 'Добавьте запись - здесь появится график.' })}
        <div class="seg small">${[[30, 'Месяц'], [90, '3 месяца'], [0, 'Всё время']].map(([k, v]) => `<button class="${S.range === k ? 'on' : ''}" data-a="range" data-k="${k}">${v}</button>`).join('')}</div>
      </div>
      <button class="btn primary block" data-a="wAdd">Добавить запись</button>
      ${S.metric !== 'weight' && !pts.length ? '<p class="hint">Мерьте в одном и том же месте, утром, сантиметровой лентой без натяга - так цифры можно сравнивать между собой.</p>' : ''}
      ${pts.length ? `<h2 class="sec">Записи</h2><div class="card list flat">${[...pts].reverse().slice(0, 60).map((p, i, arr) => {
        const prev = arr[i + 1];
        const d = prev ? p.v - prev.v : null;
        return `<div class="li"><div><b>${fmtKg(p.v)} ${m.unit}</b><div class="muted">${fmtDate(p.d, true)}</div></div><span class="row">${d ? `<span class="muted">${d > 0 ? '+' : '−'}${fmtKg(Math.abs(d))}</span>` : ''}<button class="x" data-a="wDel" data-id="${p.d}">✕</button></span></div>`;
      }).join('')}</div>` : ''}`;
  } else if (S.pSeg === 'photos') {
    body = `
      <div class="row">
        <label class="btn primary grow">Добавить фото<input type="file" accept="image/*" multiple hidden data-c="photoAdd"></label>
        ${S.photos.length > 1 ? '<button class="btn soft" data-a="cmpOpen">Сравнить</button>' : ''}
      </div>
      ${S.photos.length ? `<div class="grid">${S.photos.map((p) => `<button class="ph" data-a="phOpen" data-id="${p.id}"><img src="${thumbUrl(p)}" alt=""><span>${fmtDate(p.date)}</span></button>`).join('')}</div>`
        : '<div class="empty">Снимайте себя раз в неделю-две в одном и том же месте и при одном свете - так изменения видны лучше, чем на весах. Фотографии остаются только на этом телефоне.</div>'}`;
  } else if (S.pSeg === 'records') {
    const recs = records();
    body = recs.length
      ? `<p class="hint top0">Лучший подход по каждому упражнению. Нажмите, чтобы увидеть график.</p>${recs.map((r) => `<button class="card srow" data-a="openEx" data-id="${r.ex}"><div><h4>${esc(exOf(r.ex).name)}</h4><div class="muted">${fmtDate(r.d)}</div></div><span class="qty">${setLabel(r.best)}</span></button>`).join('')}`
      : '<div class="empty">После первой тренировки здесь появятся лучшие результаты по каждому упражнению.</div>';
  } else {
    body = vStats();
  }
  return `
  <header class="top"><h1>Прогресс</h1></header>
  <div class="seg">${[['stats', 'Обзор'], ['body', 'Тело'], ['photos', 'Фото'], ['records', 'Рекорды']].map(([k, v]) => `<button class="${S.pSeg === k ? 'on' : ''}" data-a="pSeg" data-k="${k}">${v}</button>`).join('')}</div>
  ${body}`;
}

function openEx(id) {
  const ex = exOf(id), hist = exHistory(id);
  if (!hist.length) return;
  const all = hist.flatMap((h) => h.sets);
  const mode = all.some((x) => x.sec) ? 'sec' : all.some((x) => x.kg > 0) ? 'kg' : 'reps';
  const pts = hist.map((h) => ({ d: h.d, v: Math.max(...h.sets.map((x) => x[mode] || 0)) }));
  const best = records().find((r) => r.ex === id);
  sheet(`
    <div class="eyebrow">${esc(ex.g)}</div>
    <h2>${esc(ex.name)}</h2>
    <div class="card rec-big"><div><div class="eyebrow">Рекорд</div><b>${setLabel(best.best)}</b></div><span class="muted">${fmtDate(best.d, true)}</span></div>
    <div class="card">
      <div class="eyebrow">Лучший подход за тренировку: ${{ sec: 'секунды', kg: 'вес, кг', reps: 'повторы' }[mode]}</div>
      ${lineChart(pts)}
    </div>
    <h2 class="sec">Тренировки: ${hist.length}</h2>
    <div class="list">${[...hist].reverse().slice(0, 12).map((h) => `<div class="li col"><span class="muted">${fmtDate(h.d, true)}</span><div class="tags">${h.sets.map((x) => `<span class="tag ghost">${x.sec ? x.sec + ' сек' : x.reps + (x.kg ? ' × ' + fmtKg(x.kg) + ' кг' : '')}</span>`).join('')}</div></div>`).join('')}</div>
    ${ex.tip ? `<details class="tip"><summary>Как выполнять</summary><p>${esc(ex.tip)}</p></details>` : ''}`, true);
}

function openSession(id) {
  const s = S.sessions.find((x) => x.id === id);
  if (!s) return;
  const st = sessionStats(s);
  sheet(`
    <div class="eyebrow">${fmtDate(s.day, true)}</div>
    <h2>${esc(s.name)}</h2>
    <div class="tiles">
      <div class="card tile"><b>${fmtDur(s.durationSec)}</b><span>время</span></div>
      <div class="card tile"><b>${st.sets}</b><span>${plural(st.sets, ['подход', 'подхода', 'подходов'])}</span></div>
      <div class="card tile"><b>${st.vol ? fmtKg(st.vol) : st.reps}</b><span>${st.vol ? 'кг поднято' : plural(st.reps, ['повтор', 'повтора', 'повторов'])}</span></div>
    </div>
    <div class="list">${s.items.map((it) => `<div class="li col"><b>${esc(exOf(it.ex).name)}</b><div class="tags">${it.sets.map((x) => `<span class="tag ghost">${x.sec ? x.sec + ' сек' : x.reps + (x.kg ? ' × ' + fmtKg(x.kg) + ' кг' : '')}</span>`).join('')}</div></div>`).join('')}</div>
    <div class="sticky-actions">
      ${findWorkout(s.workoutId) ? `<button class="btn primary block" data-a="startW" data-id="${s.workoutId}">Повторить</button>` : ''}
      <button class="btn danger-soft block" data-a="sDel" data-id="${s.id}">Удалить запись</button>
    </div>`, true);
}

/* ---------- Фотографии ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
function scaled(img, max, q) {
  return new Promise((resolve, reject) => {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', q);
  });
}
async function addPhotos(files) {
  let added = 0, failed = 0;
  for (const f of files) {
    try {
      const img = await loadImage(f);
      const meta = { id: uid(), date: today(), thumb: await scaled(img, 480, 0.72) };
      const blob = await scaled(img, 1600, 0.86);
      await DB.put('photoFiles', { id: meta.id, blob });
      await DB.put('photos', meta);
      S.photos.unshift(meta);
      added++;
    } catch (e) { console.error(e); failed++; }
  }
  if (failed) toast(`Не удалось добавить: ${failed}. ${added ? 'Остальные сохранены.' : 'Возможно, на телефоне нет места.'}`);
  render();
}

let viewUrls = [];
async function fullUrl(id) {
  const rec = await DB.get('photoFiles', id);
  if (!rec) return '';
  const u = URL.createObjectURL(rec.blob);
  viewUrls.push(u);
  return u;
}
function dropViewUrls() { viewUrls.forEach((u) => URL.revokeObjectURL(u)); viewUrls = []; }

async function openPhoto(id) {
  const p = S.photos.find((x) => x.id === id);
  if (!p) return;
  dropViewUrls();
  const el = sheet(`
    <img class="ph-full" id="ph-full" src="${thumbUrl(p)}" alt="">
    <label class="field"><span>Дата снимка</span><input class="inp" type="date" max="${today()}" value="${p.date}" data-c="phDate" data-id="${p.id}"></label>
    <button class="btn danger-soft block" data-a="phDel" data-id="${p.id}">Удалить фото</button>`, true);
  const u = await fullUrl(id);
  const img = $('#ph-full', el);
  if (u && img) img.src = u;
}

let CMP = null;
function openCompare() {
  const sorted = [...S.photos].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  CMP = { a: sorted[0].id, b: sorted[sorted.length - 1].id, sorted };
  const opts = (sel) => sorted.map((p, i) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${fmtDate(p.date, true)}${sorted.filter((x) => x.date === p.date).length > 1 ? ' · №' + (i + 1) : ''}</option>`).join('');
  CMP.el = sheet(`
    <h2>Сравнение</h2>
    <div class="row"><label class="field grow"><span>Было</span><select class="inp" data-c="cmpSel" data-k="a">${opts(CMP.a)}</select></label><label class="field grow"><span>Стало</span><select class="inp" data-c="cmpSel" data-k="b">${opts(CMP.b)}</select></label></div>
    <div class="cmp"><img id="cmp-b" alt=""><img id="cmp-a" alt=""><i id="cmp-line"></i></div>
    <input type="range" class="range" min="0" max="100" value="50" data-i="cmpRange">
    <p class="hint">Двигайте ползунок: слева «было», справа «стало».</p>`, true);
  drawCompare();
}
async function drawCompare() {
  dropViewUrls();
  const [a, b] = await Promise.all([fullUrl(CMP.a), fullUrl(CMP.b)]);
  $('#cmp-a', CMP.el).src = a;
  $('#cmp-b', CMP.el).src = b;
}

/* ---------- Экран «Профиль» ---------- */

const equipToggles = () => Object.entries(EQUIP).map(([k, v]) => `<button class="chip big${myEquip().includes(k) ? ' on' : ''}" data-a="eq" data-k="${k}">${v}</button>`).join('');

function vProfile() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `
  <header class="top"><h1>Профиль</h1></header>

  ${standalone ? '' : `<div class="card note"><b>Поставьте значок на экран «Домой»</b><p class="muted">В Safari нажмите «Поделиться» и выберите «На экран “Домой”». Программа будет открываться как обычное приложение и работать без интернета. Данные, внесённые в Safari, в приложение со значка не переходят - начните вести записи уже оттуда.</p></div>`}

  <h2 class="sec">Мой инвентарь</h2>
  <div class="card"><div class="chips wrap">${equipToggles()}</div><p class="hint">От этого зависит, какие тренировки и упражнения показываются.</p></div>

  <h2 class="sec">Настройки</h2>
  <div class="card list flat">
    <button class="li" data-a="planOpen"><div><b>План на неделю</b><div class="muted">${(() => { const n = DAY_NAMES.filter((_, i) => planFor(i)).length; return n ? `${n} ${plural(n, ['день', 'дня', 'дней'])} с тренировкой` : 'не составлен'; })()}</div></div><span class="chev">›</span></button>
    <div class="li"><div><b>Цель по весу, кг</b></div><input class="inp short" inputmode="decimal" placeholder="нет" data-c="goal" value="${S.settings.goal ? fmtKg(S.settings.goal) : ''}"></div>
    <div class="li"><div><b>Отдых по умолчанию</b><div class="muted">для новых упражнений в своих тренировках</div></div>${stepper('', S.settings.rest + ' с', 'data-a="restStep"')}</div>
    <button class="li" data-a="sound"><div><b>Звук таймера</b></div><i class="sw${S.settings.sound ? ' on' : ''}"></i></button>
  </div>

  <h2 class="sec">Данные</h2>
  <div class="card">
    <p class="muted">Всё хранится только на этом телефоне: ${S.sessions.length} ${plural(S.sessions.length, ['тренировка', 'тренировки', 'тренировок'])}, ${S.weights.length + S.measures.length} ${plural(S.weights.length + S.measures.length, ['запись', 'записи', 'записей'])} веса и замеров, ${S.photos.length} фото. Если удалить значок с экрана или стереть данные Safari, они пропадут - поэтому время от времени сохраняйте копию в «Файлы» или iCloud.</p>
    <div id="persist" class="hint"></div>
    <button class="btn soft block" data-a="export">Сохранить копию</button>
    <label class="btn soft block">Восстановить из копии<input type="file" accept="application/json,.json" hidden data-c="import"></label>
  </div>`;
}

async function paintPersist() {
  const el = $('#persist');
  if (!el || !navigator.storage || !navigator.storage.persisted) return;
  const ok = await navigator.storage.persisted();
  el.textContent = ok ? 'Телефон подтвердил: данные не будут удалены автоматически.' : 'Телефон может сам очистить данные при нехватке места. Копия защищает от этого.';
}

/* ---------- Резервная копия ---------- */

const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const dataUrlToBlob = (u) => fetch(u).then((r) => r.blob());

async function exportData() {
  toast('Готовлю копию…');
  try {
    const files = await DB.all('photoFiles');
    const fileMap = new Map(files.map((f) => [f.id, f.blob]));
    const photos = [];
    for (const p of S.photos) {
      const blob = fileMap.get(p.id);
      photos.push({ id: p.id, date: p.date, thumb: await blobToDataUrl(p.thumb), full: blob ? await blobToDataUrl(blob) : null });
    }
    const data = { app: 'forma', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, workouts: S.workouts, sessions: S.sessions, weights: S.weights, measures: S.measures, exercises: S.exercises, photos };
    const file = new File([JSON.stringify(data)], `forma-kopiya-${today()}.json`, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { console.error(e); toast('Не удалось собрать копию.'); }
}

async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
  if (!data || data.app !== 'forma' || !Array.isArray(data.sessions) || !Array.isArray(data.weights)) {
    toast('Это не копия программы «Форма».');
    return;
  }
  const ok = await choose('Восстановить из копии?', `Копия от ${fmtDate(String(data.exportedAt || today()).slice(0, 10), true)}: тренировок ${data.sessions.length}, записей веса ${data.weights.length}, фото ${(data.photos || []).length}. Нынешние данные на телефоне будут заменены.`, [{ label: 'Заменить данные', value: true, kind: 'danger' }, { label: 'Отмена', value: false }]);
  if (!ok) return;
  try {
    // Снимки переводим в файлы до очистки: если копия повреждена, старые данные останутся целы.
    const photos = [];
    for (const p of data.photos || []) {
      photos.push({ meta: { id: p.id, date: p.date, thumb: await dataUrlToBlob(p.thumb) }, blob: p.full ? await dataUrlToBlob(p.full) : null });
    }
    for (const s of DB.KEYED) await DB.clear(s);
    await DB.put('kv', { ...S.settings, ...data.settings }, 'settings');
    await DB.del('kv', 'active');
    for (const w of data.workouts || []) await DB.put('workouts', w);
    for (const s of data.sessions) await DB.put('sessions', s);
    for (const w of data.weights) await DB.put('weights', w);
    for (const m of data.measures || []) await DB.put('measures', m);
    for (const e of data.exercises || []) await DB.put('exercises', e);
    for (const p of photos) {
      await DB.put('photos', p.meta);
      if (p.blob) await DB.put('photoFiles', { id: p.meta.id, blob: p.blob });
    }
    thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    thumbUrls.clear();
    await load();
    render();
    toast('Данные восстановлены.');
  } catch (e) { console.error(e); toast('Восстановить не удалось: файл повреждён или не хватило места.'); await load(); render(); }
}

/* ---------- Отрисовка и действия ---------- */

function render() {
  const views = { home: vHome, workouts: vWorkouts, progress: vProgress, profile: vProfile };
  $('#view').innerHTML = views[S.tab]();
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.t === S.tab));
  if (S.tab === 'profile') paintPersist();
}

const A = {
  tab(el) { S.tab = el.dataset.t; render(); window.scrollTo(0, 0); },
  closeSheet() { closeSheet(); },
  goWeight() { S.tab = 'progress'; S.pSeg = 'body'; S.metric = 'weight'; render(); window.scrollTo(0, 0); },

  // Тренировки
  wSeg(el) { S.wSeg = el.dataset.k; render(); },
  wFocus(el) { S.wFocus = el.dataset.k; render(); },
  wFit() { S.wFit = !S.wFit; render(); },
  openW(el) { openWorkout(el.dataset.id); },
  async startW(el) {
    const w = findWorkout(el.dataset.id);
    if (!w) return;
    if (S.active) {
      const ok = await choose('Есть незаконченная тренировка', `«${S.active.name}» не завершена. Если начать новую, её подходы не сохранятся.`, [{ label: 'Начать новую', value: true, kind: 'primary' }, { label: 'Отмена', value: false }]);
      if (!ok) return;
    }
    startWorkout(w);
  },
  resume() { resumeWorkout(); },
  newW() { openEditor(null); },
  copyW(el) { closeSheet(); openEditor(findWorkout(el.dataset.id), true); },
  editW(el) { closeSheet(); openEditor(findWorkout(el.dataset.id)); },
  async delW(el) {
    const w = findWorkout(el.dataset.id);
    if (!(await confirmDel('Удалить тренировку?', `«${w.name}» исчезнет из списка. Записи о выполненных тренировках останутся.`))) return;
    if (await store(() => DB.del('workouts', w.id))) {
      S.workouts = S.workouts.filter((x) => x.id !== w.id);
      // Удалённая тренировка не должна оставаться в плане пустым днём.
      const plan = { ...(S.settings.plan || {}) };
      let touched = false;
      for (const k of Object.keys(plan)) if (plan[k] === w.id) { plan[k] = null; touched = true; }
      if (touched) { S.settings.plan = plan; await saveSettings(); }
    }
    closeSheet(); render();
  },

  // Редактор
  edStep(el) {
    const it = E.items[+el.dataset.idx], f = el.dataset.f, d = +el.dataset.d;
    const rules = { sets: [1, 1, 10], reps: [1, 1, 100], sec: [5, 5, 600], rest: [5, 0, 300] }[f];
    it[f] = clamp(it[f] + d * rules[0], rules[1], rules[2]);
    drawEditor();
  },
  edMove(el) {
    const i = +el.dataset.idx, j = i + +el.dataset.d;
    if (j < 0 || j >= E.items.length) return;
    [E.items[i], E.items[j]] = [E.items[j], E.items[i]];
    drawEditor();
  },
  edDel(el) { E.items.splice(+el.dataset.idx, 1); drawEditor(); },
  edAdd() { openPicker(); },
  async edSave() {
    if (!E.items.length) { toast('Добавьте хотя бы одно упражнение.'); return; }
    const w = { id: E.id || 'c_' + uid(), name: E.name.trim() || 'Моя тренировка', items: E.items };
    if (!(await store(() => DB.put('workouts', w)))) return;
    const i = S.workouts.findIndex((x) => x.id === w.id);
    if (i >= 0) S.workouts[i] = w; else S.workouts.push(w);
    closeSheet(E.el);
    S.tab = 'workouts'; S.wSeg = 'mine';
    render();
    toast('Тренировка сохранена.');
  },
  pkG(el) { PK.g = el.dataset.k; drawPicker(); },
  pkFit() { PK.fit = !PK.fit; drawPicker(); },
  pkAdd(el) {
    const ex = exOf(el.dataset.id);
    E.items.push(ex.t === 't' ? { ex: ex.id, sets: 3, sec: 30, rest: S.settings.rest } : { ex: ex.id, sets: 3, reps: 12, rest: S.settings.rest });
    drawPicker(); drawEditor();
    toast(`Добавлено: ${ex.name}`);
  },

  // Режим тренировки
  pStep(el) {
    const f = el.dataset.f, d = +el.dataset.d;
    P.cur[f] = clamp(P.cur[f] + d, f === 'reps' ? 1 : 0, 999);
    $(f === 'reps' ? '[data-i="pReps"]' : '[data-i="pKg"]').value = f === 'reps' ? P.cur.reps : fmtKg(P.cur.kg);
  },
  pDone() { record({ reps: P.cur.reps, kg: P.cur.kg }); },
  pStart() {
    unlockAudio();
    if (P.t.endsAt) { P.t.left = Math.max(0, (P.t.endsAt - Date.now()) / 1000); P.t.endsAt = null; }
    else P.t.endsAt = Date.now() + P.t.left * 1000;
    drawPlayer();
  },
  pSkip() { advance(true); },
  pRestAdd() { P.t.endsAt += 15000; P.t.total += 15; P.t.lastBeep = null; tick(); },
  pRestSkip() { P.t.endsAt = null; goNext(); },
  async pClose() {
    const hasSets = P.log.some((l) => l.length);
    const v = await choose('Закончить тренировку?', hasSets ? 'Выполненные подходы можно записать в историю.' : 'Пока не выполнено ни одного подхода.', [
      ...(hasSets ? [{ label: 'Записать и закончить', value: 'save', kind: 'primary' }] : []),
      { label: 'Отложить - продолжу позже', value: 'later' },
      { label: 'Выйти без записи', value: 'drop', kind: 'danger-soft' },
      { label: 'Вернуться', value: null, kind: 'ghost' },
    ]);
    if (!P || !v) return;
    if (v === 'save') return finish();
    if (v === 'later') await persistActive(); else await clearActive();
    closePlayer();
  },
  pFinish() { closePlayer(); },

  // Прогресс
  pSeg(el) { S.pSeg = el.dataset.k; render(); },
  range(el) { S.range = +el.dataset.k; render(); },
  metric(el) { S.metric = el.dataset.k; render(); },
  wAdd() {
    const m = METRICS[S.metric], pts = series(S.metric);
    const last = pts[pts.length - 1];
    sheet(`
      <h2>${m.name}</h2>
      <label class="field"><span>Дата</span><input class="inp" type="date" id="w-date" max="${today()}" value="${today()}"></label>
      <label class="field"><span>${m.name}, ${m.unit}</span><input class="inp huge" id="w-kg" inputmode="decimal" placeholder="0,0" value="${last ? fmtKg(last.v) : ''}"></label>
      <button class="btn primary block" data-a="wSave">Сохранить</button>`);
  },
  async wSave() {
    const m = METRICS[S.metric];
    const v = num($('#w-kg').value), date = $('#w-date').value;
    if (!v || v < m.min || v > m.max) { toast(`Введите значение в ${m.unit === 'кг' ? 'килограммах' : 'сантиметрах'}, ${m.hint}.`); return; }
    if (!date || date > today()) { toast('Дата не может быть в будущем.'); return; }
    const val = Math.round(v * 10) / 10;
    if (S.metric === 'weight') {
      const rec = { id: date, kg: val };
      if (!(await store(() => DB.put('weights', rec)))) return;
      S.weights = S.weights.filter((w) => w.id !== date).concat(rec).sort((a, b) => a.id.localeCompare(b.id));
    } else {
      const rec = { id: `${S.metric}|${date}`, m: S.metric, d: date, v: val };
      if (!(await store(() => DB.put('measures', rec)))) return;
      S.measures = S.measures.filter((x) => x.id !== rec.id).concat(rec).sort((a, b) => a.d.localeCompare(b.d));
    }
    closeSheet(); render();
  },
  async wDel(el) {
    const m = METRICS[S.metric], date = el.dataset.id;
    if (!(await confirmDel('Удалить запись?', `${m.name} за ${fmtDate(date, true)}.`))) return;
    if (S.metric === 'weight') {
      if (await store(() => DB.del('weights', date))) S.weights = S.weights.filter((w) => w.id !== date);
    } else {
      const id = `${S.metric}|${date}`;
      if (await store(() => DB.del('measures', id))) S.measures = S.measures.filter((x) => x.id !== id);
    }
    render();
  },
  openEx(el) { openEx(el.dataset.id); },
  calNav(el) {
    const now = new Date();
    const cal = S.cal || { y: now.getFullYear(), m: now.getMonth() };
    const d = new Date(cal.y, cal.m + +el.dataset.d, 1);
    if (d > now) return;
    S.cal = { y: d.getFullYear(), m: d.getMonth() };
    render();
  },
  calDay(el) {
    const list = S.sessions.filter((s) => s.day === el.dataset.d);
    if (list.length === 1) openSession(list[0].id);
    else if (list.length) sheet(`<div class="eyebrow">${fmtDate(el.dataset.d, true)}</div><h2>Тренировки за день</h2>${list.map(sessionRow).join('')}`);
  },
  allHistory() { sheet(`<h2>Вся история</h2>${S.sessions.map(sessionRow).join('')}`, true); },
  achOpen(el) {
    const x = achievements().find((y) => y.id === el.dataset.id);
    const cur = x.target >= 1000 ? Math.round(x.cur) : Math.round(x.cur * 10) / 10;
    choose(`${x.icon} ${x.name}`, `${x.desc} ${x.done ? 'Получено.' : x.target > 1 ? `Выполнено: ${fmtKg(cur)} из ${x.target}${x.unit ? ' ' + x.unit : ''}.` : 'Пока не получено.'}`, [{ label: 'Понятно', value: true }]);
  },

  // План на неделю
  planOpen() { openPlan(); },
  planDone() { closeSheet(); render(); },

  // Свои упражнения
  exNew() { openExForm(null); },
  exEdit(el) { openExForm(EX[el.dataset.id]); },
  xfG(el) { XF.g = el.dataset.k; drawExForm(); },
  xfT(el) { XF.t = el.dataset.k; drawExForm(); },
  xfW() { XF.w = XF.w ? 0 : 1; drawExForm(); },
  xfEq(el) {
    const i = XF.eq.indexOf(el.dataset.k);
    if (i >= 0) XF.eq.splice(i, 1); else XF.eq.push(el.dataset.k);
    drawExForm();
  },
  async xfSave() {
    const name = XF.name.trim();
    if (!name) { toast('Дайте упражнению название.'); return; }
    const rec = { id: XF.id || 'x_' + uid(), name, g: XF.g, eq: XF.eq, t: XF.t, w: XF.t === 'r' && XF.w ? 1 : 0, tip: XF.tip.trim(), custom: true };
    // Только что заведённое упражнение должно быть видно в списке, даже если
    // отбор по инвентарю или группе его скрыл бы.
    if (PK) {
      if (!rec.eq.every((x) => myEquip().includes(x))) PK.fit = false;
      if (PK.g !== 'Все' && PK.g !== rec.g) PK.g = 'Все';
      PK.q = '';
      const q = PK.el.querySelector('[data-i="pkQ"]');
      if (q) q.value = '';
    }
    if (await saveCustomEx(rec)) toast(XF.id ? 'Упражнение изменено.' : 'Упражнение добавлено в список.');
  },
  async xfDel() {
    const ok = await choose('Убрать упражнение из списка?', 'Выбрать его для новых тренировок будет нельзя. В уже записанных тренировках и в рекордах оно останется.', [{ label: 'Убрать', value: true, kind: 'danger' }, { label: 'Отмена', value: false }]);
    if (!ok) return;
    // Не удаляем, а прячем: иначе история потеряла бы название упражнения.
    await saveCustomEx({ ...EX[XF.id], hidden: true });
  },

  openS(el) { openSession(el.dataset.id); },
  async sDel(el) {
    if (!(await confirmDel('Удалить запись о тренировке?', 'Вернуть её будет нельзя.'))) return;
    if (await store(() => DB.del('sessions', el.dataset.id))) S.sessions = S.sessions.filter((s) => s.id !== el.dataset.id);
    closeSheet(); render();
  },
  phOpen(el) { openPhoto(el.dataset.id); },
  async phDel(el) {
    if (!(await confirmDel('Удалить фото?', 'Вернуть его будет нельзя.'))) return;
    const id = el.dataset.id;
    const ok = await store(async () => { await DB.del('photos', id); await DB.del('photoFiles', id); });
    if (ok) {
      S.photos = S.photos.filter((p) => p.id !== id);
      if (thumbUrls.has(id)) { URL.revokeObjectURL(thumbUrls.get(id)); thumbUrls.delete(id); }
    }
    closeSheet(); render();
  },
  cmpOpen() { openCompare(); },

  // Профиль
  eq(el) {
    const k = el.dataset.k, list = myEquip().slice();
    const i = list.indexOf(k);
    if (i >= 0) list.splice(i, 1); else list.push(k);
    S.settings.equip = list;
    document.querySelectorAll(`[data-a="eq"][data-k="${k}"]`).forEach((b) => b.classList.toggle('on', i < 0));
    saveSettings();
  },
  eqDone() { if (!S.settings.equip) S.settings.equip = []; saveSettings(); closeSheet(); render(); },
  restStep(el) { S.settings.rest = clamp(S.settings.rest + +el.dataset.d * 5, 0, 300); saveSettings(); render(); },
  sound() { S.settings.sound = !S.settings.sound; saveSettings(); render(); },
  export() { exportData(); },
};

// Поля ввода: «input» - пока человек печатает, «change» - когда выбор сделан.
const I = {
  edName(el) { E.name = el.value; },
  xfName(el) { XF.name = el.value; },
  xfTip(el) { XF.tip = el.value; },
  pkQ(el) { PK.q = el.value; drawPicker(); },
  pReps(el) { const n = parseInt(el.value, 10); if (n > 0) P.cur.reps = Math.min(n, 999); },
  pKg(el) { const n = num(el.value); if (n !== null && n >= 0) P.cur.kg = Math.min(n, 999); },
  cmpRange(el) {
    $('#cmp-a', CMP.el).style.clipPath = `inset(0 ${100 - el.value}% 0 0)`;
    $('#cmp-line', CMP.el).style.left = el.value + '%';
  },
};
const C = {
  photoAdd(el) { const files = [...el.files]; el.value = ''; if (files.length) addPhotos(files); },
  async phDate(el) {
    const p = S.photos.find((x) => x.id === el.dataset.id);
    if (!p || !el.value || el.value > today()) return;
    p.date = el.value;
    await store(() => DB.put('photos', p));
    S.photos.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    render();
  },
  cmpSel(el) { CMP[el.dataset.k] = el.value; drawCompare(); },
  planSel(el) {
    S.settings.plan = { ...(S.settings.plan || {}), [el.dataset.k]: el.value || null };
    saveSettings();
  },
  goal(el) {
    const n = num(el.value);
    S.settings.goal = n && n >= 20 && n <= 400 ? Math.round(n * 10) / 10 : null;
    if (el.value.trim() && !S.settings.goal) toast('Цель - вес в килограммах, например 78.');
    saveSettings();
  },
  import(el) { const f = el.files[0]; el.value = ''; if (f) importData(f); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (el && A[el.dataset.a]) A[el.dataset.a](el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-i]');
  if (el && I[el.dataset.i]) I[el.dataset.i](el);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-c]');
  if (el && C[el.dataset.c]) C[el.dataset.c](el);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && P) { keepAwake(true); tick(); }
});

async function boot() {
  // Регистрация идёт первой и не зависит от загрузки данных: если версия
  // встала криво и хранилище не открылось, вылечить это может только обновление.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // Пришла новая версия: перезагружаемся сразу, но только если человек ничем
    // не занят - посреди тренировки или открытой формы страницу не трогаем,
    // тогда новая версия откроется при следующем запуске.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !P && !document.querySelector('.sheet-wrap, .dialog-wrap')) location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch((e) => console.error(e));
  }
  try { await load(); }
  catch (e) {
    console.error(e);
    $('#view').innerHTML = '<div class="empty">Не удалось открыть хранилище данных. Закройте программу и откройте её снова - обычно этого достаточно. В частном режиме Safari хранилище недоступно: откройте программу в обычной вкладке или со значка на экране.</div>';
    return;
  }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if (S.settings.equip === null) {
    sheet(`
      <h2>Что у вас есть дома?</h2>
      <p class="muted">Отметьте инвентарь - покажу тренировки, которые с ним можно делать. Поменять можно в любой момент в профиле.</p>
      <div class="chips wrap">${equipToggles()}</div>
      <button class="btn primary block" data-a="eqDone">Готово</button>`);
  }
}
boot();

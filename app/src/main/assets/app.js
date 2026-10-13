(function () {
  'use strict';

  var STORE = 'diver-calc-v1';
  var NB = ' ';
  // Предел парциального давления кислорода для КАС/КВС, МПа: 40 % КАС на 45 м (табл. 5 ПВС) = 0,4 × 0,55 = 0,22
  var PO2_MAX = 0.22;
  var AIR_F = 0.209;

  var DEFAULTS = {
    gas: 'air', fo2: '40', cond: 'work', interval: '120', depth: '30', exp: '40', deco: 'air', o2env: 'water',
    f: { train: false, pred: false, cold: false, lowp: false, heavy: false }, tab: 1,
    units: 'mpa', base: 'n2', V: '40', Pf: '15', Pr: '0', FO2r: '20,9', Fsrc: '99,5', Patm: '760', rP: ''
  };
  var UNITS = {
    mpa: { k: 0.1, label: 'МПа', dec: 2, big: 2, small: 3 },
    kgf: { k: 1 / 0.980665, label: 'кгс/см²', dec: 1, big: 1, small: 2 },
    bar: { k: 1, label: 'бар', dec: 1, big: 1, small: 2 }
  };
  var GAS_NAME = { air: 'Воздух', kas: 'КАС', kvs: 'КВС', o2: 'Кислород' };
  var FACTOR_NAMES = { train: 'малотренированный', pred: 'предрасположенность', cold: 'вода ниже 10 °C', lowp: 'давление ниже 745 мм', heavy: 'тяжёлая работа' };
  var TABLE_INFO = {
    t1: 'Таблица 1 — рабочие режимы',
    t2_30: 'Таблица 2 — повторные спуски, интервал 30–119 мин',
    t2_120: 'Таблица 2 — повторные спуски, интервал 120–359 мин',
    t2_360: 'Таблица 2 — повторные спуски, интервал 360 мин и более',
    t3: 'Таблица 3 — аварийные режимы',
    t4: 'Таблица 4 — высокогорье',
    t5: 'Таблица 5 — 40 % КАС',
    t6: 'Таблица 6 — тренировочные спуски в барокамере'
  };
  var CONDS = [
    { v: 'work', b: 'Рабочий спуск', s: 'таблица 1' },
    { v: 'repeat', b: 'Повторный спуск', s: 'таблица 2, после декомпрессии предыдущего' },
    { v: 'emerg', b: 'Аварийная задержка на грунте', s: 'таблица 3 — только после фактической задержки сверх таблиц 1–2' },
    { v: 'alt', b: 'Высокогорье', s: 'таблица 4' },
    { v: 'chamber', b: 'Барокамера, 0,8–1 МПа', s: 'таблица 6 — тренировочные спуски на 80 и 100 м' }
  ];

  var S = load();
  var U = UNITS[S.units] || UNITS.mpa;
  var lastEval = null;

  // ---------- утилиты ----------
  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function num(s) {
    if (s === null || s === undefined) return NaN;
    s = String(s).replace(/\s+/g, '').replace(',', '.');
    if (s === '' || s === '-' || s === '.') return NaN;
    var x = Number(s);
    return isFinite(x) ? x : NaN;
  }
  function fmt(x, d) { return x.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtIn(x) { return x.toLocaleString('ru-RU', { maximumFractionDigits: 2 }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  function hm(min) {
    if (min < 60) return min + NB + 'мин';
    var h = Math.floor(min / 60), m = min % 60;
    return h + NB + 'ч' + (m ? ' ' + (m < 10 ? '0' : '') + m + NB + 'мин' : '');
  }
  function hmShort(min) { var h = Math.floor(min / 60), m = min % 60; return h + ':' + (m < 10 ? '0' : '') + m; }
  function pct(f) { return fmtIn(Math.round(f * 1000) / 10) + NB + '%'; }
  function Pv(bar) { return fmt(bar * U.k, U.dec); }
  function P(bar) { return Pv(bar) + NB + U.label; }
  function toField(x) { return x.toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(x) >= 10 ? U.big : U.small, useGrouping: false }); }
  function pabs(d) { return 0.1 + d / 100; } // МПа абсолютного давления на глубине d м
  function ead(d, f) { return (d + 10) * (1 - f) / (1 - AIR_F) - 10; }

  function load() {
    var s = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      var o = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (o && typeof o === 'object') {
        Object.keys(DEFAULTS).forEach(function (k) {
          if (k === 'f' && o.f) Object.keys(DEFAULTS.f).forEach(function (j) { s.f[j] = !!o.f[j]; });
          else if (o[k] !== undefined && k !== 'f') s[k] = o[k];
        });
      }
    } catch (e) { /* без сохранённых настроек */ }
    return s;
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* не страшно */ } }

  // ---------- таблицы ----------
  function depthKeys(t) { return Object.keys(PVS[t]).map(Number).sort(function (a, b) { return a - b; }); }
  function depthLabel(t, key) { var l = PVS[t][key].l; return l + NB + 'м'; }
  function gasF() { return S.gas === 'air' ? AIR_F : S.gas === 'o2' ? 1 : num(S.fo2) / 100; }
  function is40(f) { return Math.abs(f - 0.40) <= 0.01 + 1e-9; }
  function nFactors() { return Object.keys(S.f).filter(function (k) { return S.f[k]; }).length; }

  // Предельная глубина для смеси (без учёта условий спуска)
  function modFor(gas, f) {
    if (gas === 'air') return { max: 60, why: 'Таблицы ПВС для воздуха — до 60' + NB + 'м. Глубже — только в исключительных случаях (помощь аварийному водолазу).' };
    if (gas === 'o2') return { max: 20, why: 'Кислород под водой — до 20' + NB + 'м (pO₂ 0,3' + NB + 'МПа), время дыхания ограничено.' };
    if (!(f > AIR_F + 0.001 && f < 1)) return { max: NaN, why: '' };
    var dm = Math.floor((PO2_MAX / f - 0.1) * 100 + 1e-9);
    var m = Math.min(dm, 60);
    var why = is40(f)
      ? 'Для 40' + NB + '% КАС — таблица 5 ПВС, глубины 21–45' + NB + 'м (pO₂ на 45' + NB + 'м — 0,22' + NB + 'МПа).'
      : 'pO₂ не выше 0,22' + NB + 'МПа — как у 40' + NB + '% КАС на 45' + NB + 'м (таблица 5 ПВС).' + (dm > 60 ? ' Ограничено 60' + NB + 'м — пределом таблиц.' : '');
    return { max: m, why: why, ext: !is40(f) };
  }

  // Какая таблица применяется (без глубины)
  function tableFor(f) {
    var g = S.gas;
    if (g === 'o2') return { t: 'o2' };
    var nitrox = g === 'kas' || g === 'kvs';
    if (nitrox && is40(f) && S.cond === 'work') return { t: 't5', ead: false };
    var t = { work: 't1', repeat: 't2_' + S.interval, emerg: 't3', alt: 't4', chamber: 't6' }[S.cond] || 't1';
    if (nitrox && t === 't6') t = 't1';
    return { t: t, ead: nitrox };
  }
  function condAllowed(v) {
    if (S.gas === 'o2') return false;
    if (v === 'chamber') return S.gas === 'air';
    return true;
  }

  // ---------- главная оценка ----------
  function evaluate() {
    var R = { errs: { 1: [], 2: [], 3: [], 4: [] }, warns: { 1: [], 2: [], 3: [], 4: [] }, info: [] };
    var f = gasF(), D = num(S.depth), E = num(S.exp);
    R.f = f; R.D = D; R.E = E;
    var nitrox = S.gas === 'kas' || S.gas === 'kvs';

    if (nitrox && !(f > AIR_F + 0.001 && f < 1)) R.errs[1].push('Укажите процент кислорода больше 21 и меньше 100.');
    R.mod = modFor(S.gas, f);

    // Приготовление: предел достижимого процента
    R.prep = computePrep(f);
    if (nitrox && R.prep && R.prep.fmax !== undefined && f > R.prep.fmax + 1e-9 && !isNaN(R.prep.fmax)) {
      R.errs[1].push('Такую смесь не приготовить с параметрами баллона на вкладке 3: не более ' + pct(R.prep.fmax) + '.');
    }

    if (!(D > 0)) R.errs[2].push('Укажите глубину спуска.');
    if (!(E > 0)) R.errs[2].push('Укажите ' + (S.gas === 'o2' ? 'время работы' : 'экспозицию на грунте') + '.');
    if (R.errs[1].length || R.errs[2].length) return finish(R);

    // Ограничение по смеси
    var chamber = S.gas === 'air' && S.cond === 'chamber';
    if (!chamber && D > R.mod.max + 1e-9) {
      var msg = 'Спуск недопустим: для ' + gasLabel(f) + ' предельная глубина ' + R.mod.max + NB + 'м.';
      R.errs[2].push(msg); R.errs[1].push('При глубине ' + fmtIn(D) + NB + 'м: ' + msg.replace('Спуск недопустим: ', ''));
      return finish(R);
    }
    if (nitrox) R.po2 = f * pabs(D);

    if (S.gas === 'o2') return finish(evalO2(R, D, E));

    var tf = tableFor(f); R.t = tf.t; R.viaEAD = tf.ead;
    if (tf.t === 't6') return finish(evalT6(R, D, E));

    // Правила повторных спусков
    if (S.cond === 'repeat' && S.interval === '30' && D > 40) {
      R.errs[2].push('Спуск недопустим: при повторных спусках глубже 40' + NB + 'м интервал должен быть не менее 2' + NB + 'ч.');
      return finish(R);
    }

    var Dt = D;
    if (tf.ead) { R.ead = ead(D, f); Dt = Math.max(R.ead, 0); }
    var keys = depthKeys(tf.t);
    if (tf.t === 't5' && Dt < keys[0]) R.info.push('Глубина меньше 21' + NB + 'м — режим по строке 21' + NB + 'м (округление в большую сторону).');
    var key = null;
    for (var i = 0; i < keys.length; i++) if (keys[i] >= Dt - 1e-9) { key = keys[i]; break; }
    if (key === null) {
      R.errs[2].push('Спуск недопустим: в таблице режимы есть до ' + keys[keys.length - 1] + NB + 'м' + (tf.ead ? ' (ЭВГ ' + fmt(R.ead, 1) + NB + 'м)' : '') + '.');
      return finish(R);
    }
    if (tf.t !== 't5' && Dt < 10 && keys[0] >= 10) R.info.push('Глубина меньше 10' + NB + 'м — режим по первой строке таблицы (' + depthLabel(tf.t, keys[0]) + ').');
    R.key = key; R.rows = PVS[tf.t][key].r; R.depthLabel = depthLabel(tf.t, key);

    var rows = R.rows, base = -1;
    for (var j = 0; j < rows.length; j++) if (rows[j].e !== null && rows[j].e >= E - 1e-9) { base = j; break; }
    var maxE = 0; rows.forEach(function (r) { if (r.e !== null && r.e > maxE) maxE = r.e; });
    R.maxE = maxE;
    if (base < 0) {
      var s = 'Спуск недопустим: на ' + R.depthLabel + ' режимы есть для экспозиции до ' + maxE + NB + 'мин.';
      if (tf.t === 't1' || tf.t.indexOf('t2') === 0) s += ' Если задержка на грунте уже произошла — аварийные режимы (таблица 3).';
      R.errs[2].push(s);
      return finish(R);
    }
    R.base = base;
    R.shift = Math.min(nFactors(), 2);
    R.sel = base + R.shift;
    if (R.sel >= rows.length) {
      R.errs[2].push('Спуск недопустим: неблагоприятных факторов ' + nFactors() + ', а удлинённого режима на ' + R.shift + ' строк' + (R.shift === 1 ? 'у' : 'и') + ' ниже в таблице нет. Уменьшите экспозицию.');
      R.errs[4].push('Нужного удлинённого режима в таблице нет.');
      return finish(R);
    }
    R.row = rows[R.sel];
    R.decoOpts = decoOptions(tf.t, R.row);
    if (R.decoOpts.map(function (o) { return o.v; }).indexOf(S.deco) < 0) S.deco = R.decoOpts[0].v;
    R.reg = regime(tf.t, R.row, S.deco);

    if (tf.ead) R.warns[2].push('Режим по эквивалентной воздушной глубине (ЭВГ): ' + gasLabel(f) + ' на ' + fmtIn(D) + NB + 'м ≈ воздух на ' + fmt(R.ead, 1) + NB + 'м. Это расширение за рамками ПВС — в ПВС режимы есть только для воздуха и 40' + NB + '% КАС.');
    if (R.row.n) R.row.n.forEach(function (n) { R.warns[2].push('⚠ ' + n); });
    if (S.cond === 'emerg') R.info.push('Аварийные режимы применяются только после фактической аварийной задержки на грунте сверх экспозиций таблиц 1 и 2.');
    if (S.cond === 'repeat') R.info.push('Повторные спуски — только для устойчивых к декомпрессионной болезни водолазов после медосмотра. За 12' + NB + 'ч — не более 4 спусков до 20' + NB + 'м или 2 спусков до 60' + NB + 'м; следующие — не ранее чем через 24' + NB + 'ч.');
    return finish(R);
  }

  function evalO2(R, D, E) {
    var tbl = S.o2env === 'chamber' ? PVS.o2c : PVS.o2w;
    var row = null;
    for (var i = 0; i < tbl.length; i++) if (tbl[i].d >= D - 1e-9) { row = tbl[i]; break; }
    if (!row) { R.errs[2].push('Спуск недопустим: дыхание кислородом — не глубже 20' + NB + 'м.'); return R; }
    var heavy = S.f.heavy;
    var lim = S.o2env === 'chamber' ? row.max : (heavy ? row.heavy : row.light);
    R.o2 = { tbl: tbl, row: row, lim: lim, heavy: heavy };
    if (E > lim) {
      R.errs[2].push('Спуск недопустим: на ' + row.d + NB + 'м допустимо дышать кислородом не более ' + hm(lim) + (S.o2env === 'chamber' ? ' (в барокамере)' : heavy ? ' при тяжёлой работе' : ' при лёгкой и средней работе') + '.');
    }
    return R;
  }

  function evalT6(R, D, E) {
    if (D <= 60) { R.errs[2].push('Для давления до 0,6' + NB + 'МПа (60' + NB + 'м) в барокамере применяются рабочие режимы — выберите «Рабочий спуск» (10' + NB + 'м = 0,1' + NB + 'МПа).'); return R; }
    if (D > 100) { R.errs[2].push('Спуск недопустим: таблица 6 — только для 0,8 и 1' + NB + 'МПа (80 и 100' + NB + 'м).'); return R; }
    var mpa = D <= 80 ? 0.8 : 1.0;
    var rows = PVS.t6.filter(function (r) { return Math.abs(r.mpa - mpa) < 1e-9; });
    R.rows = rows; R.key = mpa * 100; R.depthLabel = fmt(mpa, 1) + NB + 'МПа (' + mpa * 100 + NB + 'м)';
    var r = rows[0];
    R.maxE = r.e;
    if (E > r.e) { R.errs[2].push('Спуск недопустим: в таблице 6 время под наибольшим давлением — ' + r.e + NB + 'мин.'); return R; }
    R.base = 0; R.shift = 0; R.sel = 0; R.row = r;
    if (nFactors()) R.warns[2].push('Удлинённых режимов в таблице 6 нет — неблагоприятные факторы не учитываются.');
    R.decoOpts = [{ v: 'air', l: 'Воздух' }]; S.deco = 'air';
    R.reg = regime('t6', r, 'air');
    if (r.n) r.n.forEach(function (n) { R.warns[2].push('⚠ ' + n); });
    return R;
  }

  function finish(R) {
    R.ok = !R.errs[1].length && !R.errs[2].length && !R.errs[4].length;
    return R;
  }

  function gasLabel(f) {
    if (S.gas === 'air') return 'воздуха';
    if (S.gas === 'o2') return 'кислорода';
    return (S.gas === 'kas' ? 'КАС ' : 'КВС ') + pct(f);
  }

  function decoOptions(t, row) {
    if (t === 't5') return [{ v: 'kas', l: '40' + NB + '% КАС' }, { v: 'o2', l: 'Кислород (≤' + NB + '15' + NB + 'м)' }];
    var hasO2 = row.s.some(function (s) { return s[2] !== null; });
    if (!hasO2) return [{ v: 'air', l: 'Воздух' }];
    return [{ v: 'air', l: 'Воздух' }, { v: 'o2', l: 'Воздух + кислород' }];
  }

  // Режим: список остановок с газом
  function regime(t, row, deco) {
    // Воздушная пауза — остановка без кислородного значения между кислородными
    var deepO2 = -1, shallowO2 = Infinity;
    row.s.forEach(function (s) { if (s[2] !== null) { deepO2 = Math.max(deepO2, s[0]); shallowO2 = Math.min(shallowO2, s[0]); } });
    var stops = row.s.map(function (s) {
      var d = s[0], a = s[1], o = s[2], g, m = a;
      if (t === 't5') g = deco === 'o2' ? 'o2' : 'mix';
      else if (deco === 'o2' && o !== null) { g = 'o2'; m = o; }
      else if (deco === 'o2' && d < deepO2 && d > shallowO2) g = 'pause';
      else g = 'air';
      return { d: d, m: m, g: g, star: !!s[3] };
    });
    var total = row.tr, o2 = 0;
    stops.forEach(function (s) { total += s.m; if (s.g === 'o2') o2 += s.m; });
    return { tr: row.tr, stops: stops, total: total, o2: o2, t: t };
  }

  // ---------- приготовление ----------
  function prepParams() {
    var p = {
      V: num(S.V), Pf: num(S.Pf) / U.k, Pr: num(S.Pr) / U.k, FO2r: num(S.FO2r), Fsrc: num(S.Fsrc),
      Patm: num(S.Patm) / 750.062
    };
    p.base = S.gas === 'kvs' ? 'air' : S.base;
    p.Ftop = p.base === 'n2' ? 0 : AIR_F * 100;
    return p;
  }
  function prepValidate(p, f) {
    var keys = ['V', 'Pf', 'Pr', 'FO2r', 'Fsrc', 'Patm'];
    for (var i = 0; i < keys.length; i++) if (isNaN(p[keys[i]])) return 'Заполните все поля на вкладке «Приготовление» числами.';
    if (p.V <= 0) return 'Объём баллона должен быть больше нуля.';
    if (p.Patm < 0.5 || p.Patm > 1.2) return 'Проверьте атмосферное давление: обычно около 760' + NB + 'мм рт. ст.';
    if (p.Pr < 0) return 'Остаток в баллоне не может быть отрицательным.';
    if (p.Pf <= p.Pr) return 'Давление готовой смеси должно быть больше остатка в баллоне.';
    if (p.FO2r < 0 || p.FO2r > 100) return 'Процент кислорода в остатке — от 0 до 100.';
    if (p.Fsrc <= p.Ftop || p.Fsrc > 100) return 'Чистота кислорода должна быть больше, чем кислорода в основном газе, и не больше 100' + NB + '%.';
    return null;
  }
  // Все давления — бар, по манометру. Порядок: сначала основной газ, затем кислород (п. 3 приложения 13 ПВС)
  function computePrep(f) {
    if (!(S.gas === 'kas' || S.gas === 'kvs')) return null;
    var p = prepParams();
    var e = prepValidate(p, f);
    if (e) return { error: e, p: p };
    var Pa = p.Patm, PfA = p.Pf + Pa, PrA = p.Pr + Pa;
    var fr = p.FO2r / 100, ft = p.Ftop / 100, fs = p.Fsrc / 100;
    var fmax = (fr * PrA + fs * (PfA - PrA)) / PfA;
    var res = { p: p, fmax: fmax };
    if (!(f > 0 && f < 1)) return res;
    var dO2 = (f * PfA - fr * PrA - ft * (PfA - PrA)) / (fs - ft);
    if (dO2 < -1e-9) {
      var bleed = PfA * (f - ft) / (fr - ft) - Pa;
      res.error = bleed >= 0
        ? 'В остатке уже больше кислорода, чем нужно. Стравите баллон до ' + P(bleed) + ' и посчитайте заново с этим остатком.'
        : 'В остатке слишком много кислорода: стравите баллон полностью и посчитайте заново.';
      return res;
    }
    var dTop = PfA - PrA - dO2;
    if (dTop < -1e-9) { res.error = 'При таком давлении больше ' + pct(fmax) + ' кислорода не получить.'; return res; }
    res.dO2 = Math.max(dO2, 0); res.dTop = Math.max(dTop, 0);
    res.stopBase = PrA + res.dTop - Pa;
    res.litersO2 = res.dO2 * p.V / Pa;
    res.litersTop = res.dTop * p.V / Pa;
    return res;
  }
  function prepReverse(r, f, rPbar) {
    var p = r.p, Pa = p.Patm, PfA = p.Pf + Pa, PrA = p.Pr + Pa;
    var fr = p.FO2r / 100, ft = p.Ftop / 100, fs = p.Fsrc / 100;
    var nowA = rPbar + Pa, d = nowA - PrA;
    if (d < -0.05) return { state: 'below' };
    if (d < 0) d = 0;
    if (nowA > PfA) return { state: 'over' };
    var o2Now = fr * PrA + ft * d, fNow = o2Now / nowA;
    return {
      state: 'ok',
      fFinal: (o2Now + fs * (PfA - nowA)) / PfA,
      PfNeed: fs > f ? nowA + (f * nowA - o2Now) / (fs - f) - Pa : NaN,
      bleedTo: fs > fNow ? PfA * (fs - f) / (fs - fNow) - Pa : NaN
    };
  }

  // ---------- отрисовка ----------
  function setChecked(container, attr, value) {
    each(container.querySelectorAll('[' + attr + ']'), function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute(attr) === String(value)));
    });
  }
  function msgs(list, cls) {
    return list.map(function (m) { return '<div class="msg ' + cls + '">' + m + '</div>'; }).join('');
  }

  function render() {
    var R = lastEval = evaluate();
    renderTabs(R);
    renderP1(R);
    renderP2(R);
    renderP3(R);
    renderP4(R);
    renderBar(R);
    save();
  }

  function renderTabs(R) {
    each(document.querySelectorAll('.tab'), function (b) {
      var n = +b.getAttribute('data-tab');
      b.setAttribute('aria-selected', String(n === S.tab));
      var dot = b.querySelector('.dot');
      var err = R.errs[n].length || (n === 4 && !R.ok) || (n === 3 && R.prep && R.prep.error);
      var warn = R.warns[n].length;
      dot.className = 'dot' + (err ? ' err' : warn ? ' warn' : ' hidden');
    });
    for (var i = 1; i <= 4; i++) $('p' + i).classList.toggle('hidden', i !== S.tab);
  }

  // --- 1. Смесь
  function renderP1(R) {
    var D = R.D, E = R.E, nitrox = S.gas === 'kas' || S.gas === 'kvs';
    each(document.querySelectorAll('.gas'), function (b) {
      var g = b.getAttribute('data-gas'), why = '';
      if (D > 0) {
        if (g === 'o2' && D > 20) why = 'не глубже 20' + NB + 'м';
        else if (g === 'air' && D > 60 && S.cond !== 'chamber') why = 'не глубже 60' + NB + 'м';
        else if (g === 'o2' && E > 0) {
          var row = null; (S.o2env === 'chamber' ? PVS.o2c : PVS.o2w).forEach(function (r) { if (!row && r.d >= D - 1e-9) row = r; });
          var lim = row && (S.o2env === 'chamber' ? row.max : S.f.heavy ? row.heavy : row.light);
          if (row && E > lim) why = 'на ' + row.d + NB + 'м — не более ' + hm(lim);
        }
      }
      b.disabled = !!why && S.gas !== g;
      b.querySelector('.why').textContent = why ? 'Недоступно: ' + why : '';
      b.setAttribute('aria-checked', String(S.gas === g));
    });

    $('fo2Field').classList.toggle('hidden', !nitrox);
    var hint = '', bad = false;
    if (nitrox) {
      var hi = 99;
      if (D > 0) hi = Math.min(hi, Math.floor(PO2_MAX / pabs(D) * 1000 + 1e-9) / 10);
      if (R.prep && R.prep.fmax !== undefined && !isNaN(R.prep.fmax)) hi = Math.min(hi, Math.floor(R.prep.fmax * 1000 + 1e-9) / 10);
      hint = 'Допустимо 22–' + fmtIn(hi) + NB + '%' + (D > 0 ? ' при глубине ' + fmtIn(D) + NB + 'м' : '');
      bad = R.errs[1].length > 0;
      if (S.cond === 'work' && is40(R.f)) hint += '. 40±1' + NB + '% — таблица 5 ПВС';
    }
    $('fo2Hint').textContent = hint;
    $('fo2Hint').classList.toggle('bad', bad);
    $('fo2Box').classList.toggle('bad', bad);
    syncChips();

    var h = '';
    if (R.errs[1].length) {
      h += '<div class="hero bad"><div class="k">Спуск недопустим</div><div class="v">' + R.errs[1][0] + '</div></div>';
    } else if (!isNaN(R.mod.max)) {
      var sub = R.mod.why;
      h += '<div class="hero"><div class="k">Предельная глубина спуска' + (R.mod.ext ? ' (расчёт по pO₂)' : ' по ПВС') + '</div>' +
        '<div class="v">' + R.mod.max + '<small>м</small></div><div class="s">' + sub + '</div></div>';
    }
    if (!R.errs[1].length) {
      var st = [];
      if (S.gas !== 'o2' && R.f > 0) {
        st.push(stat('Кислорода', pct(R.f), S.gas === 'air' ? 'атмосферный воздух' : S.gas === 'kas' ? 'кислород + азот' : 'кислород + воздух'));
        if (D > 0) st.push(stat('pO₂ на ' + fmtIn(D) + NB + 'м', fmt(R.f * pabs(D), 3) + NB + 'МПа', 'предел ' + (S.gas === 'air' ? '— не ограничивает' : fmt(PO2_MAX, 2) + NB + 'МПа')));
        if (nitrox && D > 0) st.push(stat('ЭВГ на ' + fmtIn(D) + NB + 'м', fmt(Math.max(ead(D, R.f), 0), 1) + NB + 'м', 'эквивалентная воздушная глубина', true));
      } else if (S.gas === 'o2') {
        var lim = PVS.o2w.map(function (r) { return r.d + NB + 'м — ' + hm(S.f.heavy ? r.heavy : r.light); }).join(', ');
        st.push(stat('Допустимое время под водой', S.f.heavy ? 'тяжёлая работа' : 'лёгкая и средняя работа', lim, true));
      }
      if (st.length) h += '<div class="card"><div class="stats">' + st.join('') + '</div></div>';
      if (R.mod.ext) h += '<div class="msg warn">Для смеси ' + pct(R.f) + ' в ПВС нет таблиц. Предельная глубина — по pO₂ 0,22' + NB + 'МПа, режимы декомпрессии — по ЭВГ (таблицы для воздуха). Это расширение за рамками ПВС.</div>';
      if (S.gas === 'o2') h += '<div class="msg info">Таблицы декомпрессии ПВС для кислорода не предусмотрены — ограничением служит допустимое время дыхания кислородом (вкладка 2).</div>';
    }
    $('modOut').innerHTML = h;
  }
  function stat(k, v, s, wide) {
    return '<div class="stat' + (wide ? ' wide' : '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  }

  // --- 2. Декомпрессия
  function renderP2(R) {
    var nitrox = S.gas === 'kas' || S.gas === 'kvs';
    var fOk = !(nitrox && !(R.f > AIR_F + 0.001 && R.f < 1));
    var tf = !fOk ? null : (S.gas === 'o2' ? { t: 'o2' } : tableFor(R.f));
    $('p2sub').textContent = S.gas === 'o2'
      ? 'Кислород: допустимое время дыхания по глубине.'
      : tf ? (TABLE_INFO[tf.t] || '') + (tf.ead ? ' · по ЭВГ' : '') : 'Сначала исправьте смесь на вкладке 1.';

    // Условия
    var t5 = nitrox && is40(R.f) && S.cond === 'work';
    var ch = '';
    if (S.gas === 'o2') {
      $('conds').innerHTML = '';
    } else {
      CONDS.forEach(function (c) {
        var ok = condAllowed(c.v);
        var sub = c.s;
        if (c.v === 'work' && nitrox) sub = is40(R.f) ? 'таблица 5 — 40' + NB + '% КАС' : 'таблица 1 по ЭВГ';
        else if (nitrox && c.v !== 'chamber') sub += ' (по ЭВГ)';
        ch += '<button type="button" class="opt" role="radio" data-cond="' + c.v + '"' + (ok ? '' : ' disabled') + '><span class="r"></span><span><b>' + c.b + '</b><small>' + (ok ? sub : 'только для воздуха') + '</small></span></button>';
      });
      $('conds').innerHTML = ch;
      setChecked($('conds'), 'data-cond', S.cond);
    }
    $('intervalBox').classList.toggle('hidden', S.gas === 'o2' || S.cond !== 'repeat');
    setChecked($('interval'), 'data-v', S.interval);
    each($('interval').querySelectorAll('button'), function (b) {
      b.disabled = b.getAttribute('data-v') === '30' && R.D > 40 && S.interval !== '30';
    });
    $('o2envBox').classList.toggle('hidden', S.gas !== 'o2');
    setChecked($('o2env'), 'data-v', S.o2env);
    $('expLabel').textContent = S.gas === 'o2' ? 'Время дыхания кислородом' : 'Экспозиция на грунте';

    // Глубина: подсказка и чипы
    var maxD = S.gas === 'air' && S.cond === 'chamber' ? 100 : R.mod.max;
    var dh = '';
    if (!isNaN(maxD)) dh = 'Допустимо до ' + maxD + NB + 'м';
    if (R.key !== undefined && !R.errs[2].length && S.gas !== 'o2') dh += ' · по таблице: ' + R.depthLabel + (R.viaEAD ? ' (ЭВГ ' + fmt(R.ead, 1) + NB + 'м)' : '');
    if (S.gas === 'o2' && R.o2) dh += ' · по таблице: ' + R.o2.row.d + NB + 'м';
    $('depthHint').textContent = dh;
    var dChips = S.gas === 'o2' ? [5, 10, 15, 20] : S.cond === 'chamber' && S.gas === 'air' ? [80, 100]
      : t5 ? [21, 24, 27, 30, 33, 36, 39, 42, 45] : [10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
    $('depthChips').innerHTML = dChips.map(function (v) {
      return '<button type="button" class="chip' + (num(S.depth) === v ? ' on' : '') + '" data-set="depth" data-v="' + v + '"' + (v > maxD + 1e-9 ? ' disabled' : '') + '>' + v + '</button>';
    }).join('');
    var depthBad = R.errs[2].some(function (m) { return /глубин|до \d+\s?м|не глубже|0,6|0,8/.test(m); });
    $('depthBox').classList.toggle('bad', depthBad || (num(S.depth) > maxD));

    // Экспозиция
    var eh = '', eChips = [];
    if (S.gas === 'o2') {
      if (R.o2) { eh = 'Не более ' + hm(R.o2.lim); eChips = [10, 20, 30, 60, 90, 120, 150].filter(function (v) { return v <= R.o2.lim; }); if (eChips.indexOf(R.o2.lim) < 0) eChips.push(R.o2.lim); }
    } else if (R.rows) {
      var ex = R.rows.filter(function (r) { return r.e !== null; }).map(function (r) { return r.e; });
      eChips = ex;
      eh = 'В таблице на ' + R.depthLabel + ': ' + ex[0] + '–' + ex[ex.length - 1] + NB + 'мин; округляется в большую сторону';
    }
    $('expHint').textContent = eh;
    $('expChips').innerHTML = eChips.map(function (v) {
      return '<button type="button" class="chip' + (num(S.exp) === v ? ' on' : '') + '" data-set="exp" data-v="' + v + '">' + v + '</button>';
    }).join('');
    $('expBox').classList.toggle('bad', R.errs[2].some(function (m) { return /экспозиц|не более|время/.test(m); }));

    // Факторы
    each($('factors').querySelectorAll('input'), function (i) {
      var k = i.getAttribute('data-f');
      i.checked = !!S.f[k];
      i.closest('.check').classList.toggle('hidden', S.gas === 'o2' && k !== 'heavy');
    });
    $('factorsCard').querySelector('h3').textContent = S.gas === 'o2' ? 'Характер работы' : 'Неблагоприятные факторы';
    var nf = nFactors();
    $('factorsSum').textContent = S.gas === 'o2' ? (S.f.heavy ? 'тяжёлая работа — короче время' : '') : nf === 0 ? 'основной режим' : nf === 1 ? 'удлинённый на 1 строку' : 'удлинённый на 2 строки';

    // Газ на остановках
    var showDeco = !!(R.decoOpts && R.decoOpts.length > 1);
    $('decoGasCard').classList.toggle('hidden', !showDeco);
    if (R.decoOpts) {
      $('deco').innerHTML = R.decoOpts.map(function (o) { return '<button type="button" role="radio" data-v="' + o.v + '">' + o.l + '</button>'; }).join('');
      setChecked($('deco'), 'data-v', S.deco);
    }

    $('decoOut').innerHTML = renderDecoOut(R);
  }

  function renderDecoOut(R) {
    var h = '';
    if (R.errs[1].length && !R.errs[2].length) return '<div class="msg err">Смесь на вкладке 1 задана неверно: ' + R.errs[1][0] + '</div>';
    if (R.errs[2].length) return '<div class="hero bad"><div class="k">Спуск недопустим</div><div class="v">' + cap(R.errs[2][0].replace(/^Спуск недопустим:\s*/, '')) + '</div></div>' + msgs(R.errs[2].slice(1), 'err');

    if (S.gas === 'o2') {
      var o = R.o2;
      h += '<div class="hero"><div class="k">Допустимо дышать кислородом на ' + o.row.d + NB + 'м</div><div class="v">' + hmShort(o.lim) + '<small>ч:мин</small></div>' +
        '<div class="s">pO₂ ' + fmt(o.row.po2, 2) + NB + 'МПа · ' + (S.o2env === 'chamber' ? 'в барокамере' : o.heavy ? 'тяжёлая работа' : 'лёгкая и средняя работа') + ' · запланировано ' + hm(R.E) + '</div></div>';
      h += '<div class="msg info">Таблиц декомпрессии для кислорода в ПВС нет. Соблюдайте допустимое время: его превышение грозит отравлением кислородом.</div>';
      return h;
    }

    var reg = R.reg, row = R.row;
    var t6 = reg.t === 't6';
    var label = row.e === null ? 'удлинённый режим за ' + R.rows[R.sel - 1].e + NB + 'мин' : 'экспозиция ' + row.e + NB + 'мин';
    var modeName = R.shift === 0 ? 'основной режим' : 'удлинённый на ' + R.shift + ' строк' + (R.shift === 1 ? 'у' : 'и');
    h += '<div class="hero"><div class="k">Общее время декомпрессии</div><div class="v">' + hmShort(reg.total) + '<small>ч:мин</small></div>' +
      '<div class="s">' + TABLE_INFO[reg.t].split(' — ')[0] + ' · ' + R.depthLabel + ' · ' + label + ' · ' + modeName + '</div></div>';

    // остановки
    var li = '<li class="tr"><span class="d">↑</span><span class="g">Переход на ' + (reg.stops.length ? 'первую остановку' : 'поверхность') + '</span><span class="m">' + reg.tr + '<small>мин</small></span></li>';
    reg.stops.forEach(function (s) {
      var dtxt = t6 ? fmt(s.d * 10, 0) + '<small>м</small>' : s.d + '<small>м</small>';
      var gb = { air: '<span class="badge air">воздух</span>', o2: '<span class="badge o2">кислород</span>', mix: '<span class="badge mix">40 % КАС</span>', pause: '<span class="badge pause">воздушная пауза</span>' }[s.g];
      if (t6) gb += '<span class="badge air">' + fmt(s.d, 1) + ' кгс/см²</span>';
      if (s.star) gb += '<span class="badge star" title="Отсюда можно поднять для декомпрессии в барокамере">★ барокамера</span>';
      li += '<li><span class="d">' + dtxt + '</span><span class="g">' + gb + '</span><span class="m">' + s.m + '<small>мин</small></span></li>';
    });
    if (!reg.stops.length) li += '<li><span class="d">—</span><span class="g">Остановки не нужны</span><span class="m"></span></li>';
    h += '<div class="card"><div class="card-head"><h3>Остановки</h3><span class="hint">переход между остановками (1' + NB + 'мин) входит в выдержку</span></div><ul class="stops">' + li + '</ul></div>';

    var st = [stat('Всего', hm(reg.total)), stat(reg.o2 ? 'На кислороде' : 'Остановок', reg.o2 ? hm(reg.o2) : String(reg.stops.length))];
    h += '<div class="card"><div class="stats">' + st.join('') + '</div></div>';

    h += msgs(R.warns[2], 'warn');
    var info = R.info.slice();
    if (reg.stops.some(function (s) { return s.star; })) {
      var star = 'Декомпрессия в барокамере: после выдержки на остановке с ★ водолаза можно поднять на поверхность; давление в камере — по глубине этой остановки, выдержка 10' + NB + 'мин, далее — по режиму.';
      if (R.D > 44 && R.E > 20) star += ' Глубже 44' + NB + 'м — только при экспозиции не более 20–25' + NB + 'мин (иначе — лишь при неблагоприятных условиях с профилактической оксигенобаротерапией).';
      info.push(star);
    }
    if (reg.stops.some(function (s) { return s.g === 'pause'; })) info.push('Воздушная пауза — выдержка на воздухе между кислородными выдержками, как в ПВС. Её нельзя пропускать.');
    info.push('Если пропущены 1–2 остановки — немедленно (до 3' + NB + 'мин) погрузить на одну остановку глубже первой, выдержать 5' + NB + 'мин и продолжить по удлинённому режиму.');
    h += msgs(info, 'info');
    return h;
  }

  // --- 3. Приготовление
  function renderP3(R) {
    var nitrox = S.gas === 'kas' || S.gas === 'kvs';
    $('prepMain').classList.toggle('hidden', !nitrox);
    $('p3sub').textContent = nitrox ? 'Кислород добавляют в баллон с основным газом — не наоборот (приложение 13 ПВС).' : '';
    if (!nitrox) {
      $('prepNone').innerHTML = S.gas === 'air'
        ? '<div class="card"><h3>Воздух</h3><p class="body">Смешивание не требуется. Воздух для дыхания проверяется по инструкции по анализам (приложение 2 ПВС): содержание вредных примесей — не выше ПДК.</p></div>'
        : '<div class="card"><h3>Медицинский кислород</h3><p class="body">Применяется кислород по ГОСТ 5583-78 из транспортных баллонов; смешивание не требуется. Пригодность определяют по паспорту партии.</p></div>';
      return;
    }
    $('prepNone').innerHTML = '';
    setChecked($('units'), 'data-u', S.units);
    each(document.querySelectorAll('.pu'), function (el) { el.textContent = U.label; });
    var base = S.gas === 'kvs' ? 'air' : S.base;
    setChecked($('base'), 'data-v', base);
    each($('base').querySelectorAll('button'), function (b) { b.disabled = S.gas === 'kvs' && b.getAttribute('data-v') === 'n2'; });
    $('baseHint').textContent = S.gas === 'kvs' ? 'КВС готовят на воздухе' : base === 'n2' ? 'азот по ГОСТ 929-74' : 'если азота нет — очищенный воздух (ПВС)';
    $('restSum').textContent = num(S.Pr) > 0 ? 'Остаток: ' + S.Pr + NB + U.label + ', ' + S.FO2r + NB + '%' : 'Сейчас: баллон пустой';
    $('otherSum').textContent = 'Кислород ' + S.Fsrc + NB + '%, ' + S.Patm + NB + 'мм рт. ст.';

    var r = R.prep, f = R.f, baseAcc = base === 'n2' ? 'азот' : 'воздух', baseGen = base === 'n2' ? 'азота' : 'воздуха';
    var h = '';
    if (!(f > AIR_F + 0.001 && f < 1)) { $('prepOut').innerHTML = '<div class="msg err">Задайте процент кислорода на вкладке 1.</div>'; return; }
    if (!r || r.error) {
      $('prepOut').innerHTML = '<div class="msg err">' + (r ? r.error : '') + '</div>';
      $('revOut').innerHTML = '';
      return;
    }
    h += '<div class="hero"><div class="k">Сначала ' + baseAcc + ' до</div><div class="v">' + Pv(r.stopBase) + '<small>' + U.label + '</small></div>' +
      '<div class="s">затем кислород до ' + P(r.p.Pf) + ' — смесь ' + pct(f) + '</div></div>';

    var lim = base === 'n2' ? 90 : 110; // бар: 9 и 11 МПа
    var steps = [];
    if (base === 'air') steps.push('Проверьте воздух на масло: струю воздуха 4–5' + NB + 'мин направьте на белый лист — пятен быть не должно. Пары масла в смеси с кислородом взрывоопасны.');
    if (r.p.Pr > 0) steps.push('В баллоне остаток ' + P(r.p.Pr) + ' (' + fmtIn(r.p.FO2r) + NB + '% кислорода) — он учтён в расчёте.');
    steps.push((r.p.Pr > 0 ? 'Добавьте ' : 'Наберите ') + baseAcc + ' до <b class="n">' + P(r.stopBase) + '</b>. Дайте баллону остыть и проверьте манометр.');
    steps.push('Добавьте кислород в баллон с ' + (base === 'n2' ? 'азотом' : 'воздухом') + ' до <b class="n">' + P(r.p.Pf) + '</b> по остывшему баллону. <b>Никогда не перепускайте ' + baseAcc + ' в баллон с кислородом.</b>');
    steps.push('Через 2–3' + NB + 'ч — первый анализ: кислорода должно быть ' + pct(f) + ' ± 1' + NB + '%.');
    steps.push('Через сутки — повторный анализ: отличие от первого не более 0,5' + NB + '%. Пригодность смеси определяет врач-спецфизиолог.');
    steps.push('Перед заполнением баллонов водолазных аппаратов — контрольный анализ. Результаты — в журнал учёта и анализов.');
    h += '<div class="card"><h3>Последовательность</h3><ol class="steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol></div>';
    if (r.stopBase > lim + 1e-9) h += '<div class="msg warn">По ПВС давление ' + baseGen + ' в баллоне перед добавлением кислорода — не более ' + (lim / 10) + NB + 'МПа. Сейчас ' + P(r.stopBase) + ': уменьшите давление готовой смеси.</div>';

    var st = [stat(base === 'n2' ? 'Азот' : 'Воздух', fmtIn(Math.round(r.litersTop)) + NB + 'л', '+' + P(r.dTop)), stat('Кислород', fmtIn(Math.round(r.litersO2)) + NB + 'л', '+' + P(r.dO2))];
    if (r.p.Pr === 0 && Math.abs(f - 0.4) < 1e-9) {
      var k = base === 'n2' ? 0.67 : 0.33;
      var fPvs = base === 'n2' ? k / (1 + k) : (AIR_F + k) / (1 + k);
      st.push(stat('Кислорода по формуле ПВС', '+' + P(k * r.stopBase), 'Ркисл = ' + fmt(k, 2) + ' · Р' + (base === 'n2' ? 'азота' : 'возд') + ' даёт около ' + pct(fPvs) + ' — в пределах допуска 40 ± 1' + NB + '%', true));
    }
    h += '<div class="card"><h3>Сколько уйдёт газа</h3><div class="stats">' + st.join('') + '</div></div>';
    $('prepOut').innerHTML = h;

    // Обратный расчёт
    $('revTitle').textContent = (base === 'n2' ? 'Азот' : 'Воздух') + ' уже в баллоне?';
    var rP = num(S.rP), rv = '';
    if (!isNaN(rP)) {
      var q = prepReverse(r, f, rP / U.k);
      if (q.state === 'below') rv = '<div class="msg warn">Это меньше остатка в баллоне — проверьте значение.</div>';
      else if (q.state === 'over') rv = '<div class="msg warn">Это больше давления готовой смеси.</div>';
      else if (isNaN(q.PfNeed) || q.PfNeed < rP / U.k - 1e-6) rv = '<div class="msg warn">' + baseGen.charAt(0).toUpperCase() + baseGen.slice(1) + ' уже слишком много для ' + pct(f) + '. Стравите до ' + P(Math.max(q.bleedTo, 0)) + ', затем кислород до ' + P(r.p.Pf) + '.</div>';
      else {
        rv = '<div>Добавьте кислород до</div><div class="big">' + P(q.PfNeed) + '</div><div>получится ' + pct(f) + '.';
        if (q.PfNeed > r.p.Pf + 0.05) rv += ' Это выше давления готовой смеси (' + P(r.p.Pf) + ').';
        else rv += ' Если долить кислород до ' + P(r.p.Pf) + ', выйдет ' + pct(q.fFinal) + '.';
        rv += '</div>';
      }
    }
    $('revOut').innerHTML = rv;
  }

  // --- 4. Смежные режимы
  function renderP4(R) {
    var h = '';
    if (R.errs[1].length || (R.errs[2].length && !R.rows && !R.o2)) {
      $('p4sub').textContent = '';
      $('adjOut').innerHTML = '<div class="msg err">Спуск недопустим — смежных режимов нет. ' + (R.errs[1][0] || R.errs[2][0] || '') + '</div>';
      return;
    }
    if (S.gas === 'o2') {
      $('p4sub').textContent = 'Допустимое время дыхания кислородом по глубинам.';
      var tbl = S.o2env === 'chamber' ? PVS.o2c : PVS.o2w;
      h += '<div class="card"><table class="tbl"><thead><tr><th>Глубина</th><th>pO₂, МПа</th>' + (S.o2env === 'chamber' ? '<th>Максимум</th>' : '<th>Лёгкая и средняя</th><th>Тяжёлая</th>') + '</tr></thead><tbody>';
      tbl.forEach(function (r) {
        var cur = R.o2 && R.o2.row === r;
        h += '<tr' + (cur ? ' class="cur"' : '') + '><td>' + r.d + NB + 'м</td><td>' + fmt(r.po2, 2) + '</td>' + (S.o2env === 'chamber' ? '<td>' + hm(r.max) + '</td>' : '<td>' + hm(r.light) + '</td><td>' + hm(r.heavy) + '</td>') + '</tr>';
      });
      h += '</tbody></table></div>';
      if (R.errs[2].length) h = '<div class="msg err">' + R.errs[2][0] + '</div>' + h;
      $('adjOut').innerHTML = h;
      return;
    }
    if (R.base === undefined) {
      $('p4sub').textContent = '';
      $('adjOut').innerHTML = '<div class="msg err">' + (R.errs[2][0] || 'Нет режима') + '</div>';
      return;
    }
    var rows = R.rows, t = R.t;
    $('p4sub').textContent = TABLE_INFO[t].split(' — ')[0] + ' · ' + R.depthLabel + ' · на две строки короче и длиннее основного режима';
    var labels = { '-2': 'на 2 строки короче', '-1': 'на 1 строку короче', '0': 'основной режим', '1': 'удлинённый · 1 фактор', '2': 'удлинённый · 2 и более факторов' };
    h += '<div class="adj">';
    for (var k = -2; k <= 2; k++) {
      var i = R.base + k, r = rows[i];
      if (!r) { h += '<div class="it none"><div class="h"><b>' + labels[k] + '</b><span class="tag">нет в таблице</span></div></div>'; continue; }
      var reg = regime(t, r, S.deco);
      var cls = 'it' + (k === 0 ? ' base' : '') + (i === R.sel ? ' sel' : '');
      var ex = r.e === null ? 'удлинённый' : 'до ' + r.e + NB + 'мин';
      var sl = reg.stops.map(function (s) {
        var mark = s.g === 'o2' ? ' O₂' : s.g === 'pause' ? ' пауза' : '';
        return '<span>' + (t === 't6' ? fmt(s.d * 10, 0) : s.d) + NB + 'м · ' + s.m + mark + (s.star ? ' ★' : '') + '</span>';
      }).join(' ') || '<span>без остановок</span>';
      h += '<div class="' + cls + '"><div class="h"><b>' + ex + '</b><span class="tt">' + hmShort(reg.total) + '</span></div>' +
        '<div class="tag">' + labels[k] + (i === R.sel ? ' · выбран' : '') + (r.n ? ' · <span class="badge note">⚠ см. пометку</span>' : '') + '</div>' +
        '<div class="sl">переход ' + reg.tr + NB + 'мин · ' + sl + '</div></div>';
    }
    h += '</div>';
    if (R.errs[2].length) h = '<div class="msg err">' + R.errs[2][0] + '</div>' + h;
    h += '<p class="hint" style="margin-top:12px">Время — ч:мин, общее время декомпрессии' + (S.deco === 'o2' ? ' с кислородом' : '') + '. Удлинённые режимы применяются при неблагоприятных факторах (вкладка 2).</p>';
    $('adjOut').innerHTML = h;
  }

  function renderBar(R) {
    var bar = $('bar'), a, b, t = '', cls, ic;
    var firstErr = R.errs[1][0] || R.errs[2][0] || R.errs[4][0];
    if (firstErr) {
      cls = 'err'; ic = '✕'; a = 'Спуск недопустим';
      b = cap(firstErr.replace(/^Спуск недопустим:\s*/, ''));
    } else {
      var g = S.gas === 'kas' || S.gas === 'kvs' ? GAS_NAME[S.gas] + ' ' + pct(R.f) : GAS_NAME[S.gas];
      a = g + ' · ' + fmtIn(R.D) + NB + 'м · ' + fmtIn(R.E) + NB + 'мин';
      if (S.gas === 'o2') { b = 'допустимо до ' + hm(R.o2.lim); t = ''; }
      else {
        b = TABLE_INFO[R.t].split(' — ')[0] + (R.viaEAD ? ' по ЭВГ' : '') + ' · ' + (R.shift ? 'удлинённый +' + R.shift : 'основной');
        t = hmShort(R.reg.total);
      }
      var warn = R.warns[2].length || R.viaEAD;
      cls = warn ? 'warn' : 'ok'; ic = warn ? '!' : '✓';
    }
    bar.className = 'bar ' + cls;
    $('barIc').textContent = ic; $('barA').textContent = a; $('barB').textContent = b; $('barT').textContent = t;
    bar.setAttribute('aria-label', a + '. ' + b);
  }

  // ---------- поля и чипы ----------
  var FIELDS = ['fo2', 'depth', 'exp', 'V', 'Pf', 'Pr', 'FO2r', 'Fsrc', 'Patm', 'rP'];
  function buildStaticChips() {
    each(document.querySelectorAll('.chips[data-for]'), function (box) {
      var id = box.getAttribute('data-for');
      box.innerHTML = box.getAttribute('data-vals').split(' ').map(function (v) {
        return '<button type="button" class="chip" data-set="' + id + '" data-v="' + v + '">' + v + '</button>';
      }).join('');
    });
  }
  function syncChips() {
    each(document.querySelectorAll('.chips[data-for] .chip'), function (b) {
      b.classList.toggle('on', num(S[b.getAttribute('data-set')]) === num(b.getAttribute('data-v')));
    });
  }
  function setUnits(u) {
    if (!UNITS[u] || u === S.units) return;
    var from = UNITS[S.units], to = UNITS[u];
    ['Pf', 'Pr', 'rP'].forEach(function (k) {
      var x = num(S[k]);
      if (!isNaN(x)) { U = to; S[k] = toField(x / from.k * to.k); $(k).value = S[k]; }
    });
    S.units = u; U = to;
  }

  function go(tab) {
    S.tab = tab;
    render();
    window.scrollTo(0, 0);
  }

  function init() {
    // #t2&gas=kas&fo2=36 — открыть вкладку и задать поля (для проверки)
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var m = /^t([1-4])$/.exec(kv);
      if (m) { S.tab = +m[1]; return; }
      var p = kv.split('=');
      if (p.length === 2 && typeof DEFAULTS[p[0]] === 'string') S[p[0]] = decodeURIComponent(p[1]);
      else if (p.length === 2 && p[0] in DEFAULTS.f) S.f[p[0]] = p[1] === '1';
    });
    U = UNITS[S.units] || UNITS.mpa;
    buildStaticChips();
    FIELDS.forEach(function (k) {
      var el = $(k);
      el.value = S[k];
      el.addEventListener('input', function () { S[k] = el.value; render(); });
    });
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('button, .inp');
      if (!b) return;
      if (b.classList.contains('inp')) { var i = b.querySelector('input'); if (i && ev.target !== i) i.focus(); return; }
      if (b.disabled) return;
      if (b.hasAttribute('data-tab')) return go(+b.getAttribute('data-tab'));
      if (b.hasAttribute('data-go')) return go(+b.getAttribute('data-go'));
      if (b.hasAttribute('data-gas')) { S.gas = b.getAttribute('data-gas'); if (S.gas === 'kvs') S.base = 'air'; if (!condAllowed(S.cond)) S.cond = 'work'; return render(); }
      if (b.hasAttribute('data-cond')) { S.cond = b.getAttribute('data-cond'); return render(); }
      if (b.hasAttribute('data-set')) { var k = b.getAttribute('data-set'); S[k] = b.getAttribute('data-v'); $(k).value = S[k]; return render(); }
      if (b.hasAttribute('data-u')) { setUnits(b.getAttribute('data-u')); return render(); }
      var grp = b.parentNode && b.parentNode.id;
      if (grp === 'interval') { S.interval = b.getAttribute('data-v'); return render(); }
      if (grp === 'o2env') { S.o2env = b.getAttribute('data-v'); return render(); }
      if (grp === 'deco') { S.deco = b.getAttribute('data-v'); return render(); }
      if (grp === 'base') { S.base = b.getAttribute('data-v'); return render(); }
      if (b.id === 'bar') {
        var R = lastEval, t = R.errs[1].length ? 1 : R.errs[2].length ? 2 : R.errs[4].length ? 4 : 2;
        return go(t);
      }
    });
    each($('factors').querySelectorAll('input'), function (i) {
      i.addEventListener('change', function () { S.f[i.getAttribute('data-f')] = i.checked; render(); });
    });
    each(document.querySelectorAll('input[inputmode]'), function (el) {
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.blur(); });
      // При нажатии на поле значение выделяется целиком — новое число сразу заменяет старое.
      // Тап после фокуса ставит курсор и снимает выделение, поэтому выделяем и после отпускания.
      var justFocused = false;
      function selectAll() { try { el.setSelectionRange(0, el.value.length); } catch (e) { el.select(); } }
      el.addEventListener('focus', function () { justFocused = true; setTimeout(selectAll, 0); });
      el.addEventListener('mouseup', function (e) { if (justFocused) { e.preventDefault(); selectAll(); justFocused = false; } });
      el.addEventListener('touchend', function () { if (justFocused) setTimeout(selectAll, 0); });
      el.addEventListener('blur', function () { justFocused = false; });
    });
    render();
  }

  init();
})();

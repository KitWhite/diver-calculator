(function () {
  'use strict';

  var STORE = 'diver-calc-v1';
  var NB = ' ';
  // Предел парциального давления кислорода для КАС/КВС, МПа: 40 % КАС на 45 м (табл. 5 ПВС) = 0,4 × 0,55 = 0,22
  var PO2_MAX = 0.22;
  var AIR_F = 0.209;

  var DEFAULTS = {
    gas: 'air', fo2: '40', cond: 'work', interval: '120', depth: '30', exp: '40',
    f: { train: false, pred: false, cold: false, lowp: false, heavy: false }, tab: 1, sub4: 'cham', t6p: '0.8',
    units: 'mpa', base: 'n2', V: '40', Pf: '15', Pr: '0', FO2r: '20,9', Fsrc: '99,5', Patm: '760', rP: ''
  };
  var UNITS = {
    mpa: { k: 0.1, label: 'МПа', dec: 2, big: 2, small: 3 },
    kgf: { k: 1 / 0.980665, label: 'кгс/см²', dec: 1, big: 1, small: 2 },
    bar: { k: 1, label: 'бар', dec: 1, big: 1, small: 2 }
  };
  var GAS_NAME = { air: 'Воздух', kas: 'КАС', kvs: 'КВС', o2: 'Кислород' };
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
  var COND_HINT = {
    work: 'Обычный спуск.',
    repeat: 'Спуск после декомпрессии предыдущего. Глубже 40' + NB + 'м — только если прошло 2' + NB + 'ч и больше.',
    emerg: 'Только после фактической аварийной задержки на грунте сверх экспозиций рабочих режимов.',
    alt: 'Спуски в водоёмах в условиях высокогорья.'
  };

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
  function mpaOf(m) { return fmt(m / 100, 2) + NB + 'МПа'; } // глубина, м -> избыточное давление в барокамере
  function pabs(d) { return 0.1 + d / 100; } // МПа абсолютного давления на глубине d м
  // Эквивалентные глубины по азоту: для воздуха и для 40 % КАС
  function ead(d, f) { return (d + 10) * (1 - f) / (1 - AIR_F) - 10; }
  function e40(d, f) { return (d + 10) * (1 - f) / 0.6 - 10; }

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
    // Переход со старых версий: вкладок стало 4, «барокамера» ушла из условий спуска
    if (!(s.tab >= 1 && s.tab <= 4)) s.tab = 2;
    if (['work', 'repeat', 'emerg', 'alt'].indexOf(s.cond) < 0) s.cond = 'work';
    return s;
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* не страшно */ } }

  // ---------- таблицы ----------
  function depthKeys(t) { return Object.keys(PVS[t]).map(Number).sort(function (a, b) { return a - b; }); }
  function depthLabel(t, key) { return PVS[t][key].l + NB + 'м'; }
  function isNitrox() { return S.gas === 'kas' || S.gas === 'kvs'; }
  function gasF() { return S.gas === 'air' ? AIR_F : S.gas === 'o2' ? 1 : num(S.fo2) / 100; }
  function fValid(f) { return f > AIR_F + 0.001 && f < 1; }
  function is40(f) { return Math.abs(f - 0.40) <= 0.01 + 1e-9; }
  function nFactors() { return Object.keys(S.f).filter(function (k) { return S.f[k]; }).length; }
  function tName(t) { return TABLE_INFO[t].split(' — ')[0]; }
  function gasShort(f) { return isNitrox() ? GAS_NAME[S.gas] + ' ' + pct(f) : GAS_NAME[S.gas]; }
  function gasGen(f) {
    if (S.gas === 'air') return 'воздуха';
    if (S.gas === 'o2') return 'кислорода';
    return (S.gas === 'kas' ? 'КАС ' : 'КВС ') + pct(f);
  }

  // Предельная глубина для смеси
  function modFor(f) {
    if (S.gas === 'air') return { max: 60, why: 'Таблицы ПВС для воздуха — до 60' + NB + 'м. Глубже — только в исключительных случаях (помощь аварийному водолазу).' };
    if (S.gas === 'o2') return { max: 20, why: 'Кислород под водой — до 20' + NB + 'м (pO₂ 0,3' + NB + 'МПа), время дыхания ограничено.' };
    if (!fValid(f)) return { max: NaN, why: '' };
    var dm = Math.floor((PO2_MAX / f - 0.1) * 100 + 1e-9);
    var why = is40(f)
      ? 'Для 40' + NB + '% КАС — таблица 5 ПВС, глубины 21–45' + NB + 'м (pO₂ на 45' + NB + 'м — 0,22' + NB + 'МПа).'
      : 'pO₂ не выше 0,22' + NB + 'МПа — как у 40' + NB + '% КАС на 45' + NB + 'м (таблица 5 ПВС).' + (dm > 60 ? ' Ограничено 60' + NB + 'м — пределом таблиц.' : '');
    return { max: Math.min(dm, 60), why: why, ext: !is40(f) };
  }

  // Какая таблица и нужен ли эквивалент.
  // Эквивалент выбирается так, чтобы табличный газ был не богаче кислородом, чем смесь водолаза:
  // тогда дыхание своей смесью на остановках не уменьшает запас.
  function tableFor(f) {
    if (S.gas === 'o2') return { t: 'o2' };
    var t = { work: 't1', repeat: 't2_' + S.interval, emerg: 't3', alt: 't4' }[S.cond] || 't1';
    if (!isNitrox()) return { t: t };
    if (S.cond === 'work') {
      if (is40(f)) return { t: 't5' };
      if (f > 0.41) return { t: 't5', eq: 'e40' };
    }
    return { t: t, eq: 'ead' };
  }

  // Предел экспозиции без остановок с учётом сдвига по неблагоприятным факторам
  function noStopLimit(rows, shift) {
    var lim = null;
    rows.forEach(function (r, i) {
      var rr = rows[i + shift];
      if (r.e !== null && rr && !rr.s.length && (!lim || r.e > lim.e)) lim = { e: r.e, tr: rr.tr };
    });
    return lim;
  }

  // Режим: остановки на той же смеси, что и спуск; rt — время от начала подъёма к концу выдержки
  function regime(row) {
    var t = row.tr;
    var stops = row.s.map(function (s) { t += s[1]; return { d: s[0], m: s[1], star: !!s[3], rt: t }; });
    return { tr: row.tr, stops: stops, total: t };
  }

  // ---------- главная оценка ----------
  function evaluate() {
    var R = { errs: { 1: [], 2: [], 3: [], 4: [] }, warns: { 1: [], 2: [], 3: [], 4: [] }, info: [] };
    var f = gasF(), D = num(S.depth), E = num(S.exp);
    R.f = f; R.D = D; R.E = E;

    if (isNitrox() && !fValid(f)) R.errs[1].push('Укажите процент кислорода больше 21 и меньше 100.');
    R.mod = modFor(f);

    R.prep = computePrep(f);
    if (isNitrox() && R.prep && !isNaN(R.prep.fmax) && R.prep.fmax !== undefined && f > R.prep.fmax + 1e-9) {
      R.errs[1].push('Такую смесь не приготовить с параметрами баллона на вкладке 4: не более ' + pct(R.prep.fmax) + '.');
    }
    if (R.prep && R.prep.error) R.errs[4].push(R.prep.error);

    if (!(D > 0)) R.errs[2].push('Укажите глубину спуска.');
    if (!(E > 0)) R.errs[2].push('Укажите ' + (S.gas === 'o2' ? 'время дыхания кислородом' : 'экспозицию на грунте') + '.');
    if (R.errs[1].length || R.errs[2].length) return finish(R);

    if (D > R.mod.max + 1e-9) {
      var msg = 'Спуск недопустим: для ' + gasGen(f) + ' предельная глубина ' + R.mod.max + NB + 'м.';
      R.errs[2].push(msg);
      R.errs[1].push('При глубине ' + fmtIn(D) + NB + 'м: ' + msg.replace('Спуск недопустим: ', ''));
      return finish(R);
    }

    if (S.gas === 'o2') return finish(evalO2(R, D, E));

    var tf = tableFor(f);
    R.t = tf.t; R.eqKind = tf.eq;
    if (S.cond === 'repeat' && S.interval === '30' && D > 40) {
      R.errs[2].push('Спуск недопустим: при повторных спусках глубже 40' + NB + 'м интервал должен быть не менее 2' + NB + 'ч.');
      return finish(R);
    }

    var Dt = D;
    if (tf.eq === 'ead') { R.eqDepth = ead(D, f); Dt = Math.max(R.eqDepth, 0); }
    if (tf.eq === 'e40') { R.eqDepth = e40(D, f); Dt = Math.max(R.eqDepth, 0); }
    var keys = depthKeys(tf.t), key = null;
    for (var i = 0; i < keys.length; i++) if (keys[i] >= Dt - 1e-9) { key = keys[i]; break; }
    if (key === null) {
      R.errs[2].push('Спуск недопустим: в таблице режимы есть до ' + keys[keys.length - 1] + NB + 'м' + (tf.eq ? ' (эквивалент — ' + fmt(R.eqDepth, 1) + NB + 'м)' : '') + '.');
      return finish(R);
    }
    if (Dt < keys[0]) R.info.push((tf.eq ? 'Эквивалентная глубина' : 'Глубина') + ' меньше ' + keys[0] + NB + 'м — режим по первой строке таблицы (' + depthLabel(tf.t, keys[0]) + ').');
    R.key = key; R.rows = PVS[tf.t][key].r; R.depthLabel = depthLabel(tf.t, key);

    var rows = R.rows, base = -1, maxE = 0;
    rows.forEach(function (r, j) {
      if (r.e === null) return;
      if (base < 0 && r.e >= E - 1e-9) base = j;
      if (r.e > maxE) maxE = r.e;
    });
    R.maxE = maxE;
    R.shift = Math.min(nFactors(), 2);
    R.nsLim = noStopLimit(rows, R.shift);
    if (base < 0) {
      var s = 'Спуск недопустим: на ' + R.depthLabel + ' режимы есть для экспозиции до ' + maxE + NB + 'мин.';
      if (tf.t === 't1' || tf.t === 't5' || tf.t.indexOf('t2') === 0) s += ' Если задержка на грунте уже случилась — выберите «Аварийный».';
      R.errs[2].push(s);
      return finish(R);
    }
    R.base = base;
    R.sel = base + R.shift;
    if (R.sel >= rows.length) {
      R.errs[2].push('Спуск недопустим: неблагоприятных факторов ' + nFactors() + ', а удлинённого режима на ' + R.shift + ' строк' + (R.shift === 1 ? 'у' : 'и') + ' ниже в таблице нет. Уменьшите экспозицию.');
      return finish(R);
    }
    R.row = rows[R.sel];
    R.reg = regime(R.row);
    R.noStop = !R.row.s.length;

    if (tf.eq) {
      var like = tf.eq === 'ead' ? 'воздух' : '40' + NB + '% КАС';
      R.warns[2].push('<b>Режим по эквиваленту.</b> Для ' + gasGen(f) + ' в ПВС режимов нет. По азоту ' + fmtIn(D) + NB + 'м на этой смеси — как ' + like + ' на ' + fmt(R.eqDepth, 1) + NB + 'м, поэтому взят режим ' + tName(tf.t).replace('Таблица', 'таблицы') + ' для ' + R.depthLabel + '. На остановках вы дышите своей смесью — кислорода в ней не меньше, чем в табличном газе.');
    }
    if (R.row.n) R.row.n.forEach(function (n) { R.warns[2].push('⚠ ' + n); });
    if (S.cond === 'repeat') R.info.push('Повторные спуски — только для устойчивых к декомпрессионной болезни водолазов после медосмотра. За 12' + NB + 'ч — не более 4 спусков до 20' + NB + 'м или 2 спусков до 60' + NB + 'м.');
    return finish(R);
  }

  function evalO2(R, D, E) {
    var row = null;
    PVS.o2w.forEach(function (r) { if (!row && r.d >= D - 1e-9) row = r; });
    var lim = S.f.heavy ? row.heavy : row.light;
    R.o2 = { row: row, lim: lim };
    R.noStop = true;
    if (E > lim) R.errs[2].push('Спуск недопустим: на ' + row.d + NB + 'м дышать кислородом допустимо не более ' + hm(lim) + (S.f.heavy ? ' при тяжёлой работе.' : ' при лёгкой и средней работе.'));
    return R;
  }

  function finish(R) {
    R.ok = !R.errs[1].length && !R.errs[2].length;
    return R;
  }

  // ---------- приготовление смеси ----------
  function prepParams() {
    var p = {
      V: num(S.V), Pf: num(S.Pf) / U.k, Pr: num(S.Pr) / U.k, FO2r: num(S.FO2r), Fsrc: num(S.Fsrc),
      Patm: num(S.Patm) / 750.062
    };
    p.base = S.gas === 'kvs' ? 'air' : S.base;
    p.Ftop = p.base === 'n2' ? 0 : AIR_F * 100;
    return p;
  }
  function prepValidate(p) {
    var keys = ['V', 'Pf', 'Pr', 'FO2r', 'Fsrc', 'Patm'];
    for (var i = 0; i < keys.length; i++) if (isNaN(p[keys[i]])) return 'Заполните все поля приготовления смеси числами.';
    if (p.V <= 0) return 'Объём баллона должен быть больше нуля.';
    if (p.Patm < 0.5 || p.Patm > 1.2) return 'Проверьте атмосферное давление: обычно около 760' + NB + 'мм рт. ст.';
    if (p.Pr < 0) return 'Остаток в баллоне не может быть отрицательным.';
    if (p.Pf <= p.Pr) return 'Давление готовой смеси должно быть больше остатка в баллоне.';
    if (p.FO2r < 0 || p.FO2r > 100) return 'Процент кислорода в остатке — от 0 до 100.';
    if (p.Fsrc <= p.Ftop || p.Fsrc > 100) return 'Чистота кислорода должна быть больше, чем кислорода в основном газе, и не больше 100' + NB + '%.';
    return null;
  }
  // Все давления — бар, по манометру. Порядок: сначала основной газ, затем кислород (приложение 13 ПВС)
  function computePrep(f) {
    if (!isNitrox()) return null;
    var p = prepParams();
    var e = prepValidate(p);
    if (e) return { error: e, p: p };
    var Pa = p.Patm, PfA = p.Pf + Pa, PrA = p.Pr + Pa;
    var fr = p.FO2r / 100, ft = p.Ftop / 100, fs = p.Fsrc / 100;
    var fmax = (fr * PrA + fs * (PfA - PrA)) / PfA;
    var res = { p: p, fmax: fmax };
    if (!fValid(f)) return res;
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

  // ---------- отрисовка: общее ----------
  function setChecked(container, attr, value) {
    each(container.querySelectorAll('[' + attr + ']'), function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute(attr) === String(value)));
    });
  }
  function msgs(list, cls) { return list.map(function (m) { return '<div class="msg ' + cls + '">' + m + '</div>'; }).join(''); }
  function stat(k, v, s, wide) {
    return '<div class="stat' + (wide ? ' wide' : '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  }
  function badHero(text) {
    return '<div class="hero bad"><div class="k">Спуск недопустим</div><div class="v">' + cap(text.replace(/^Спуск недопустим:\s*/, '')) + '</div></div>';
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

  // Прокрутить полосу вкладок так, чтобы активная была видна целиком
  function revealTab() {
    var bar = document.querySelector('.tabs'), act = $('tab' + S.tab);
    if (!bar || !act) return;
    var l = act.offsetLeft - bar.offsetLeft, r = l + act.offsetWidth;
    if (l < bar.scrollLeft) bar.scrollLeft = l - 8;
    else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = r - bar.clientWidth + 8;
  }

  function renderTabs(R) {
    each(document.querySelectorAll('.tab'), function (b) {
      var n = +b.getAttribute('data-tab');
      b.setAttribute('aria-selected', String(n === S.tab));
      var err = R.errs[n].length || (n === 3 && !R.ok);
      var warn = R.warns[n].length;
      b.querySelector('.dot').className = 'dot' + (err ? ' err' : warn ? ' warn' : ' hidden');
    });
    for (var i = 1; i <= 4; i++) $('p' + i).classList.toggle('hidden', i !== S.tab);
    revealTab();
  }

  // ---------- 1. Смесь ----------
  function renderP1(R) {
    var D = R.D, E = R.E, nitrox = isNitrox();
    each(document.querySelectorAll('.gas'), function (b) {
      var g = b.getAttribute('data-gas'), why = '';
      if (D > 0) {
        if (g === 'o2' && D > 20) why = 'не глубже 20' + NB + 'м';
        else if (g === 'air' && D > 60) why = 'не глубже 60' + NB + 'м';
        else if (g === 'o2' && E > 0) {
          var row = null; PVS.o2w.forEach(function (r) { if (!row && r.d >= D - 1e-9) row = r; });
          var lim = row && (S.f.heavy ? row.heavy : row.light);
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
      if (is40(R.f)) hint += '. 40 ± 1' + NB + '% — таблица 5 ПВС';
      bad = R.errs[1].length > 0;
    }
    $('fo2Hint').textContent = hint;
    $('fo2Hint').classList.toggle('bad', bad);
    $('fo2Box').classList.toggle('bad', bad);
    syncChips();

    var h = '';
    if (R.errs[1].length) {
      h += badHero(R.errs[1][0]);
    } else if (!isNaN(R.mod.max)) {
      h += '<div class="hero"><div class="k">Предельная глубина спуска' + (R.mod.ext ? ' (расчёт по pO₂)' : ' по ПВС') + '</div>' +
        '<div class="v">' + R.mod.max + '<small>м</small></div><div class="s">' + R.mod.why + '</div></div>';
      var st = [];
      if (S.gas !== 'o2') {
        st.push(stat('Кислорода', pct(R.f), S.gas === 'air' ? 'атмосферный воздух' : S.gas === 'kas' ? 'кислород + азот' : 'кислород + воздух'));
        if (D > 0) st.push(stat('pO₂ на ' + fmtIn(D) + NB + 'м', fmt(R.f * pabs(D), 3) + NB + 'МПа', S.gas === 'air' ? 'не ограничивает' : 'предел ' + fmt(PO2_MAX, 2) + NB + 'МПа'));
      } else {
        st.push(stat('Допустимое время под водой', S.f.heavy ? 'тяжёлая работа' : 'лёгкая и средняя работа',
          PVS.o2w.map(function (r) { return r.d + NB + 'м — ' + hm(S.f.heavy ? r.heavy : r.light); }).join(', '), true));
      }
      h += '<div class="card"><div class="stats">' + st.join('') + '</div></div>';
      if (R.mod.ext) h += '<div class="msg warn">Для смеси ' + pct(R.f) + ' в ПВС нет таблиц. Предельная глубина — по pO₂ 0,22' + NB + 'МПа, режимы декомпрессии — по эквиваленту (вкладка 2).</div>';
    }
    $('modOut').innerHTML = h;
  }

  // ---------- 2. Декомпрессия ----------
  function renderP2(R) {
    var o2 = S.gas === 'o2';
    var tf = (isNitrox() && !fValid(R.f)) ? null : tableFor(R.f);
    $('p2sub').textContent = o2 ? 'Кислород: допустимое время дыхания.'
      : tf ? TABLE_INFO[tf.t] + (tf.eq ? ' · по эквиваленту' : '') : 'Сначала задайте смесь на вкладке 1.';

    $('condBox').classList.toggle('hidden', o2);
    setChecked($('conds'), 'data-v', S.cond);
    $('condHint').textContent = (tf && !o2 ? tName(tf.t) + '. ' : '') + COND_HINT[S.cond];
    $('intervalBox').classList.toggle('hidden', S.cond !== 'repeat');
    setChecked($('interval'), 'data-v', S.interval);
    each($('interval').querySelectorAll('button'), function (b) { b.disabled = b.getAttribute('data-v') === '30' && R.D > 40 && S.interval !== '30'; });
    $('expLabel').textContent = o2 ? 'Время дыхания кислородом' : 'Экспозиция на грунте';

    // Глубина
    var maxD = R.mod.max;
    var dh = isNaN(maxD) ? '' : 'Допустимо до ' + maxD + NB + 'м';
    if (R.key !== undefined && !R.errs[2].length) dh += ' · по таблице: ' + R.depthLabel + (R.eqKind ? ' (эквивалент ' + fmt(R.eqDepth, 1) + NB + 'м)' : '');
    if (o2 && R.o2) dh += ' · по таблице: ' + R.o2.row.d + NB + 'м';
    $('depthHint').textContent = dh;
    var dChips = o2 ? [5, 10, 15, 20] : [10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
    $('depthChips').innerHTML = dChips.map(function (v) {
      return '<button type="button" class="chip' + (num(S.depth) === v ? ' on' : '') + '" data-set="depth" data-v="' + v + '"' + (v > maxD + 1e-9 ? ' disabled' : '') + '>' + v + '</button>';
    }).join('');
    $('depthBox').classList.toggle('bad', num(S.depth) > maxD || R.errs[2].some(function (m) { return /глубин|до \d+\s?м/.test(m); }));

    // Экспозиция
    var eh = '', eChips = [];
    if (o2) {
      if (R.o2) { eh = 'Не более ' + hm(R.o2.lim); eChips = [10, 20, 30, 60, 90, 120].filter(function (v) { return v < R.o2.lim; }); eChips.push(R.o2.lim); }
    } else if (R.rows) {
      eChips = R.rows.filter(function (r) { return r.e !== null; }).map(function (r) { return r.e; });
      eh = 'От начала погружения до начала подъёма. В таблице: до ' + eChips[eChips.length - 1] + NB + 'мин, округляется вверх';
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
      i.closest('.check').classList.toggle('hidden', o2 && k !== 'heavy');
    });
    var nf = nFactors();
    $('factorsTitle').textContent = o2 ? 'Характер работы' : 'Неблагоприятные факторы';
    $('factorsSum').textContent = o2 ? (S.f.heavy ? 'тяжёлая работа' : 'лёгкая и средняя работа')
      : nf === 0 ? 'нет — основной режим' : nf + ' — режим на ' + Math.min(nf, 2) + ' строк' + (nf === 1 ? 'у' : 'и') + ' длиннее';

    $('decoOut').innerHTML = renderDecoOut(R);
  }

  function renderDecoOut(R) {
    if (R.errs[1].length && !R.errs[2].length) return '<div class="msg err">Смесь на вкладке 1 задана неверно: ' + R.errs[1][0] + '</div>';
    if (R.errs[2].length) return badHero(R.errs[2][0]) + msgs(R.errs[2].slice(1), 'err');
    var h = '';

    if (S.gas === 'o2') {
      h += '<div class="hero ok"><div class="k">Декомпрессия не требуется</div><div class="v">до ' + hmShort(R.o2.lim) + '<small>ч:мин</small></div>' +
        '<div class="s">допустимое время дыхания кислородом на ' + R.o2.row.d + NB + 'м · ' + (S.f.heavy ? 'тяжёлая работа' : 'лёгкая и средняя работа') + ' · запланировано ' + hm(R.E) + '</div></div>';
      h += '<div class="msg info">Таблиц декомпрессии для кислорода в ПВС нет — ограничение одно: допустимое время дыхания. Превышение грозит отравлением кислородом.</div>';
      return h;
    }

    var reg = R.reg, row = R.row;
    var exLabel = row.e === null ? 'удлинённый режим' : 'экспозиция до ' + row.e + NB + 'мин';
    var mode = R.shift === 0 ? 'основной режим' : 'удлинённый на ' + R.shift + ' строк' + (R.shift === 1 ? 'у' : 'и');
    var where = tName(R.t) + ' · ' + R.depthLabel + ' · ' + exLabel + ' · ' + mode;

    if (R.noStop) {
      h += '<div class="hero ok"><div class="k">Декомпрессия не нужна</div><div class="v">' + reg.tr + '<small>мин подъём</small></div>' +
        '<div class="s">Подъём на поверхность без остановок · ' + where + '</div></div>';
      if (R.nsLim) h += '<div class="msg info">Без остановок на этой глубине — <b>до ' + R.nsLim.e + NB + 'мин</b>' + (R.shift ? ' с учётом неблагоприятных факторов' : '') + '.</div>';
    } else {
      h += '<div class="hero"><div class="k">Нужна декомпрессия · общее время</div><div class="v">' + hmShort(reg.total) + '<small>ч:мин</small></div><div class="s">' + where + '</div></div>';
      var gb = '<span class="badge mix">' + (S.gas === 'air' ? 'воздух' : gasShort(R.f)) + '</span>';
      var li = '<li class="tr"><span class="d">↑</span><span class="g">Подъём до первой остановки</span><span class="m">' + reg.tr + '<small>мин</small><span class="rt">к ' + hmShort(reg.tr) + '</span></span></li>';
      reg.stops.forEach(function (s) {
        li += '<li><span class="d">' + s.d + '<small>м</small></span><span class="g">' + gb + (s.star ? '<span class="badge star">★ можно в барокамеру</span>' : '') + '</span>' +
          '<span class="m">' + s.m + '<small>мин</small><span class="rt">к ' + hmShort(s.rt) + '</span></span></li>';
      });
      h += '<div class="card"><div class="card-head"><h3>Остановки</h3><span class="hint">«к 0:12» — время от начала подъёма</span></div><ul class="stops">' + li + '</ul>' +
        '<p class="hint" style="margin:8px 0 0">Переход между остановками (1' + NB + 'мин) входит в выдержку. С последней остановки на поверхность — 1–3' + NB + 'мин.</p></div>';
      h += R.nsLim
        ? '<div class="msg info">Без декомпрессии на этой глубине можно находиться <b>до ' + R.nsLim.e + NB + 'мин</b>' + (R.shift ? ' с учётом факторов' : '') + '.</div>'
        : '<div class="msg info">По ПВС на этой глубине режимов без остановок нет — даже самый короткий требует выдержки.</div>';
    }
    h += msgs(R.warns[2], 'warn');
    var info = R.info.slice();
    if (!R.noStop && reg.stops.some(function (s) { return s.star; })) info.push('★ — после этой выдержки водолаза можно поднять для декомпрессии в барокамере. Подробный порядок — вкладка 4.');
    if (!R.noStop) info.push('Пропущены 1–2 остановки — немедленно (до 3' + NB + 'мин) погрузить на одну остановку глубже первой, выдержать 5' + NB + 'мин и продолжить по удлинённому режиму (вкладка 3).');
    h += msgs(info, 'info');
    return h;
  }

  // ---------- 3. Смежные ----------
  function renderP3(R) {
    var h = '';
    if (S.gas === 'o2') {
      $('p3sub').textContent = 'Допустимое время дыхания кислородом по глубинам.';
      h += '<div class="card"><table class="tbl"><thead><tr><th>Глубина</th><th>pO₂, МПа</th><th>Лёгкая и средняя</th><th>Тяжёлая</th></tr></thead><tbody>';
      PVS.o2w.forEach(function (r) {
        h += '<tr' + (R.o2 && R.o2.row === r ? ' class="cur"' : '') + '><td>' + r.d + NB + 'м</td><td>' + fmt(r.po2, 2) + '</td><td>' + hm(r.light) + '</td><td>' + hm(r.heavy) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (R.errs[2].length) h = '<div class="msg err">' + R.errs[2][0] + '</div>' + h;
      $('adjOut').innerHTML = h;
      return;
    }
    if (R.base === undefined) {
      $('p3sub').textContent = '';
      $('adjOut').innerHTML = '<div class="msg err">Спуск недопустим — смежных режимов нет. ' + cap((R.errs[1][0] || R.errs[2][0] || '').replace(/^Спуск недопустим:\s*/, '')) + '</div>';
      return;
    }
    var rows = R.rows;
    $('p3sub').textContent = tName(R.t) + (R.eqKind ? ' по эквиваленту' : '') + ' · ' + R.depthLabel + ' · по две строки короче и длиннее основного режима';
    var labels = { '-2': 'на 2 строки короче', '-1': 'на 1 строку короче', '0': 'основной режим', '1': 'удлинённый · 1 фактор', '2': 'удлинённый · 2 и более факторов' };
    h += '<div class="adj">';
    for (var k = -2; k <= 2; k++) {
      var i = R.base + k, r = rows[i];
      if (!r) { h += '<div class="it none"><div class="h"><b>' + labels[k] + '</b><span class="tag">нет в таблице</span></div></div>'; continue; }
      var reg = regime(r);
      var cls = 'it' + (k === 0 ? ' base' : '') + (i === R.sel ? ' sel' : '');
      var ex = r.e === null ? 'удлинённый' : 'до ' + r.e + NB + 'мин';
      var body = r.s.length
        ? 'подъём ' + reg.tr + NB + 'мин · ' + reg.stops.map(function (s) { return '<span>' + s.d + NB + 'м · ' + s.m + (s.star ? ' ★' : '') + '</span>'; }).join(' ')
        : '<span class="badge ok">без остановок</span> подъём ' + reg.tr + NB + 'мин';
      h += '<div class="' + cls + '"><div class="h"><b>' + ex + '</b><span class="tt">' + (r.s.length ? hmShort(reg.total) : 'без деко') + '</span></div>' +
        '<div class="tag">' + labels[k] + (i === R.sel ? ' · выбран' : '') + (r.n ? ' · <span class="badge note">⚠ пометка</span>' : '') + '</div>' +
        '<div class="sl">' + body + '</div></div>';
    }
    h += '</div>';
    if (R.errs[2].length) h = '<div class="msg err">' + R.errs[2][0] + '</div>' + h;
    h += '<p class="hint" style="margin-top:12px">Время — ч:мин, общее время декомпрессии. Удлинённые режимы применяются при неблагоприятных факторах (вкладка 2) и при пропуске остановок.</p>';
    $('adjOut').innerHTML = h;
  }

  // ---------- 4. Барокамера и смесь ----------
  function renderP4(R) {
    setChecked($('sub4'), 'data-v', S.sub4);
    $('chamSec').classList.toggle('hidden', S.sub4 !== 'cham');
    $('prepSec').classList.toggle('hidden', S.sub4 !== 'prep');
    renderChamber(R);
    renderT6();
    renderO2c();
    renderPrep(R);
  }

  // Декомпрессия на поверхности в барокамере (п. 7 приложения 4 ПВС)
  function renderChamber(R) {
    var h = '<div class="card"><h3>Декомпрессия в барокамере</h3>';
    var body = '';
    if (!R.ok) body = '<div class="msg err">Сначала выберите допустимый режим на вкладке 2.</div>';
    else if (S.gas === 'o2') body = '<p class="body">Для дыхания кислородом декомпрессия не требуется.</p>';
    else if (R.noStop) body = '<p class="body">Выбранный режим — без остановок: декомпрессия не нужна.</p>';
    else if (R.t === 't3') body = '<p class="body">По аварийным режимам (таблица 3) декомпрессия на поверхности в барокамере ПВС не предусмотрена — только по таблицам 1, 2, 4, 5.</p>';
    else {
      var reg = R.reg, stops = reg.stops;
      var deep = R.D > 44, tooLong = R.E > 20;
      if (deep && tooLong) body += '<div class="msg warn">Глубже 44' + NB + 'м декомпрессия в барокамере допускается при экспозиции не более 20–25' + NB + 'мин. При большей — только при неблагоприятных условиях пребывания под водой и с профилактической оксигенобаротерапией после декомпрессии.</div>';
      var stopsList = function (list) {
        return '<ul class="stops">' + list.map(function (s) {
          return '<li><span class="d">' + fmt(s.d / 100, 2) + '<small>МПа</small></span><span class="g"><span class="badge air">' + s.d + NB + 'м</span></span><span class="m">' + s.m + '<small>мин</small></span></li>';
        }).join('') + '</ul>';
      };
      if (stops[0].d <= 6) {
        body += '<ol class="steps"><li>Первая остановка — ' + stops[0].d + NB + 'м, поэтому водолаза поднимают <b>прямо с грунта</b>.</li>' +
          '<li>Снять снаряжение за 3–5' + NB + 'мин.</li><li>В барокамере — режим без предварительной выдержки:</li></ol>' + stopsList(stops);
      } else {
        var stars = stops.filter(function (s) { return s.star; });
        if (!stars.length) body += '<p class="body">В этом режиме нет остановок со ★ — декомпрессия на поверхности не предусмотрена.</p>';
        else {
          var st = stars[0], under = stops.filter(function (s) { return s.d >= st.d; }), rest = stops.filter(function (s) { return s.d < st.d; });
          body += '<ol class="steps">' +
            '<li>Под водой: подъём до первой остановки (' + reg.tr + NB + 'мин) и выдержки до <b>' + st.d + NB + 'м</b> включительно: ' + under.map(function (s) { return s.d + NB + 'м — ' + s.m + NB + 'мин'; }).join(', ') + '.</li>' +
            '<li>Подъём на поверхность без остановок, снять снаряжение за 3–5' + NB + 'мин.</li>' +
            '<li>В барокамере поднять давление до <b>' + mpaOf(st.d) + '</b> (' + st.d + NB + 'м) и выдержать <b>10' + NB + 'мин</b>.</li>' +
            '<li>Дальше — остановки по режиму:</li></ol>' + (rest.length ? stopsList(rest) : '<p class="body">остановок больше нет.</p>');
          if (stars.length > 1) body += '<p class="hint">Подниматься можно и с более мелкой остановки со ★: ' + stars.slice(1).map(function (s) { return s.d + NB + 'м'; }).join(', ') + ' — тогда давление в камере по её глубине.</p>';
        }
      }
    }
    $('chamOut').innerHTML = h + body + '</div>';
  }

  function renderT6() {
    setChecked($('t6p'), 'data-v', S.t6p);
    var mpa = num(S.t6p), row = PVS.t6.filter(function (r) { return Math.abs(r.mpa - mpa) < 1e-9; })[0];
    if (!row) { $('t6Out').innerHTML = ''; return; }
    var total = row.tr + row.s.reduce(function (a, s) { return a + s[1]; }, 0);
    var li = '<li class="tr"><span class="d">↓</span><span class="g">Снижение давления до первой остановки</span><span class="m">' + row.tr + '<small>мин</small></span></li>' +
      row.s.map(function (s) {
        return '<li><span class="d">' + fmt(s[0] / 10, 2) + '<small>МПа</small></span><span class="g"><span class="badge air">' + fmt(s[0], 1) + NB + 'кгс/см²</span></span><span class="m">' + s[1] + '<small>мин</small></span></li>';
      }).join('');
    $('t6Out').innerHTML = '<div class="stats" style="margin:12px 0 4px">' + stat('Под наибольшим давлением', row.e + NB + 'мин') + stat('Общее время декомпрессии', hm(total)) + '</div>' +
      '<ul class="stops">' + li + '</ul>' + (row.n && row.n.length ? msgs(row.n.map(function (n) { return '⚠ ' + n; }), 'warn') : '');
  }

  function renderO2c() {
    var h = '<h3>Кислород в барокамере</h3><table class="tbl"><thead><tr><th>Давление</th><th>pO₂, МПа</th><th>Максимум</th></tr></thead><tbody>';
    PVS.o2c.forEach(function (r) { h += '<tr><td>' + mpaOf(r.d) + ' (' + r.d + NB + 'м)</td><td>' + fmt(r.po2, 2) + '</td><td>' + hm(r.max) + '</td></tr>'; });
    $('o2cCard').innerHTML = h + '</tbody></table><p class="hint">Максимально допустимое время дыхания кислородом в условиях водолазной барокамеры.</p>';
  }

  function renderPrep(R) {
    var nitrox = isNitrox();
    $('prepMain').classList.toggle('hidden', !nitrox);
    $('p4prepSub').textContent = nitrox ? 'Смесь ' + gasShort(R.f) + ' с вкладки 1. Кислород добавляют в баллон с основным газом — не наоборот (приложение 13 ПВС).' : '';
    if (!nitrox) {
      $('prepNone').innerHTML = S.gas === 'air'
        ? '<div class="card"><h3>Воздух</h3><p class="body">Смешивание не требуется. Воздух для дыхания проверяется по инструкции по анализам (приложение 2 ПВС): вредные примеси — не выше ПДК.</p></div>'
        : '<div class="card"><h3>Медицинский кислород</h3><p class="body">Кислород по ГОСТ 5583-78 из транспортных баллонов; смешивание не требуется. Пригодность определяют по паспорту партии.</p></div>';
      return;
    }
    $('prepNone').innerHTML = '';
    setChecked($('units'), 'data-u', S.units);
    each(document.querySelectorAll('.pu'), function (el) { el.textContent = U.label; });
    var base = S.gas === 'kvs' ? 'air' : S.base;
    setChecked($('base'), 'data-v', base);
    each($('base').querySelectorAll('button'), function (b) { b.disabled = S.gas === 'kvs' && b.getAttribute('data-v') === 'n2'; });
    $('baseHint').textContent = S.gas === 'kvs' ? 'КВС готовят на воздухе' : base === 'n2' ? 'азот по ГОСТ 929-74' : 'если азота нет — очищенный воздух';
    $('restSum').textContent = num(S.Pr) > 0 ? 'Остаток: ' + S.Pr + NB + U.label + ', ' + S.FO2r + NB + '%' : 'Сейчас: баллон пустой';
    $('otherSum').textContent = 'Кислород ' + S.Fsrc + NB + '%, ' + S.Patm + NB + 'мм рт. ст.';

    var r = R.prep, f = R.f, baseAcc = base === 'n2' ? 'азот' : 'воздух', baseGen = base === 'n2' ? 'азота' : 'воздуха';
    if (!fValid(f)) { $('prepOut').innerHTML = '<div class="msg err">Задайте процент кислорода на вкладке 1.</div>'; $('revOut').innerHTML = ''; return; }
    if (!r || r.error) { $('prepOut').innerHTML = '<div class="msg err">' + (r ? r.error : '') + '</div>'; $('revOut').innerHTML = ''; return; }

    var h = '<div class="hero"><div class="k">Сначала ' + baseAcc + ' до</div><div class="v">' + Pv(r.stopBase) + '<small>' + U.label + '</small></div>' +
      '<div class="s">затем кислород до ' + P(r.p.Pf) + ' — смесь ' + pct(f) + '</div></div>';
    var lim = base === 'n2' ? 90 : 110; // бар: 9 и 11 МПа
    var steps = [];
    if (base === 'air') steps.push('Проверьте воздух на масло: струю воздуха 4–5' + NB + 'мин направьте на белый лист — пятен быть не должно. Пары масла с кислородом взрывоопасны.');
    if (r.p.Pr > 0) steps.push('В баллоне остаток ' + P(r.p.Pr) + ' (' + fmtIn(r.p.FO2r) + NB + '% кислорода) — он учтён в расчёте.');
    steps.push((r.p.Pr > 0 ? 'Добавьте ' : 'Наберите ') + baseAcc + ' до <b class="n">' + P(r.stopBase) + '</b>. Дайте баллону остыть и проверьте манометр.');
    steps.push('Добавьте кислород в баллон с ' + (base === 'n2' ? 'азотом' : 'воздухом') + ' до <b class="n">' + P(r.p.Pf) + '</b> по остывшему баллону. <b>Никогда не перепускайте ' + baseAcc + ' в баллон с кислородом.</b>');
    steps.push('Через 2–3' + NB + 'ч — первый анализ: кислорода должно быть ' + pct(f) + ' ± 1' + NB + '%.');
    steps.push('Через сутки — повторный анализ: отличие от первого не более 0,5' + NB + '%. Пригодность смеси определяет врач-спецфизиолог.');
    steps.push('Перед заполнением баллонов водолазных аппаратов — контрольный анализ. Результаты — в журнал учёта и анализов.');
    h += '<div class="card"><h3>Последовательность</h3><ol class="steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol></div>';
    if (r.stopBase > lim + 1e-9) h += '<div class="msg warn">По ПВС давление ' + baseGen + ' перед добавлением кислорода — не более ' + (lim / 10) + NB + 'МПа. Сейчас ' + P(r.stopBase) + ': уменьшите давление готовой смеси.</div>';
    var st = [stat(base === 'n2' ? 'Азот' : 'Воздух', fmtIn(Math.round(r.litersTop)) + NB + 'л', '+' + P(r.dTop)), stat('Кислород', fmtIn(Math.round(r.litersO2)) + NB + 'л', '+' + P(r.dO2))];
    if (r.p.Pr === 0 && Math.abs(f - 0.4) < 1e-9) {
      var k = base === 'n2' ? 0.67 : 0.33, fPvs = base === 'n2' ? k / (1 + k) : (AIR_F + k) / (1 + k);
      st.push(stat('Кислорода по формуле ПВС', '+' + P(k * r.stopBase), 'Ркисл = ' + fmt(k, 2) + ' · Р' + (base === 'n2' ? 'азота' : 'возд') + ' даёт около ' + pct(fPvs) + ' — в пределах допуска 40 ± 1' + NB + '%', true));
    }
    h += '<div class="card"><h3>Сколько уйдёт газа</h3><div class="stats">' + st.join('') + '</div></div>';
    $('prepOut').innerHTML = h;

    $('revTitle').textContent = (base === 'n2' ? 'Азот' : 'Воздух') + ' уже в баллоне?';
    var rP = num(S.rP), rv = '';
    if (!isNaN(rP)) {
      var q = prepReverse(r, f, rP / U.k);
      if (q.state === 'below') rv = '<div class="msg warn">Это меньше остатка в баллоне — проверьте значение.</div>';
      else if (q.state === 'over') rv = '<div class="msg warn">Это больше давления готовой смеси.</div>';
      else if (isNaN(q.PfNeed) || q.PfNeed < rP / U.k - 1e-6) rv = '<div class="msg warn">' + cap(baseGen) + ' уже слишком много для ' + pct(f) + '. Стравите до ' + P(Math.max(q.bleedTo, 0)) + ', затем кислород до ' + P(r.p.Pf) + '.</div>';
      else {
        rv = '<div>Добавьте кислород до</div><div class="big">' + P(q.PfNeed) + '</div><div>получится ' + pct(f) + '.';
        rv += q.PfNeed > r.p.Pf + 0.05 ? ' Это выше давления готовой смеси (' + P(r.p.Pf) + ').' : ' Если долить кислород до ' + P(r.p.Pf) + ', выйдет ' + pct(q.fFinal) + '.';
        rv += '</div>';
      }
    }
    $('revOut').innerHTML = rv;
  }

  // ---------- нижняя строка ----------
  function renderBar(R) {
    var bar = $('bar'), a, b, t = '', cls, ic;
    var firstErr = R.errs[1][0] || R.errs[2][0];
    if (firstErr) {
      cls = 'err'; ic = '✕'; a = 'Спуск недопустим';
      b = cap(firstErr.replace(/^Спуск недопустим:\s*/, ''));
    } else {
      a = gasShort(R.f) + ' · ' + fmtIn(R.D) + NB + 'м · ' + fmtIn(R.E) + NB + 'мин';
      if (S.gas === 'o2') { b = 'без декомпрессии · допустимо до ' + hm(R.o2.lim); }
      else if (R.noStop) { b = 'без декомпрессии · ' + tName(R.t) + (R.eqKind ? ' по эквиваленту' : ''); t = 'без деко'; }
      else {
        b = tName(R.t) + (R.eqKind ? ' по эквиваленту' : '') + ' · ' + (R.shift ? 'удлинённый +' + R.shift : 'основной');
        t = hmShort(R.reg.total);
      }
      var warn = R.warns[2].length;
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
    U = to;
    ['Pf', 'Pr', 'rP'].forEach(function (k) {
      var x = num(S[k]);
      if (!isNaN(x)) { S[k] = toField(x / from.k * to.k); $(k).value = S[k]; }
    });
    S.units = u;
  }
  function fillFields() { FIELDS.forEach(function (k) { $(k).value = S[k]; }); }

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
    fillFields();
    FIELDS.forEach(function (k) {
      var el = $(k);
      el.addEventListener('input', function () { S[k] = el.value; render(); });
    });
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('button, .inp');
      if (!b) return;
      if (b.classList.contains('inp')) { var i = b.querySelector('input'); if (i && ev.target !== i) i.focus(); return; }
      if (b.disabled) return;
      if (b.hasAttribute('data-tab')) return go(+b.getAttribute('data-tab'));
      if (b.hasAttribute('data-go')) return go(+b.getAttribute('data-go'));
      if (b.hasAttribute('data-gas')) { S.gas = b.getAttribute('data-gas'); if (S.gas === 'kvs') S.base = 'air'; return render(); }
      if (b.hasAttribute('data-set')) { var k = b.getAttribute('data-set'); S[k] = b.getAttribute('data-v'); $(k).value = S[k]; return render(); }
      if (b.hasAttribute('data-u')) { setUnits(b.getAttribute('data-u')); return render(); }
      if (b.id === 'reset') {
        var tab = S.tab; S = JSON.parse(JSON.stringify(DEFAULTS)); S.tab = tab; U = UNITS[S.units];
        fillFields(); return render();
      }
      var grp = b.parentNode && b.parentNode.id, v = b.getAttribute('data-v');
      if (grp === 'conds') { S.cond = v; return render(); }
      if (grp === 'interval') { S.interval = v; return render(); }
      if (grp === 'sub4') { S.sub4 = v; return render(); }
      if (grp === 't6p') { S.t6p = v; return render(); }
      if (grp === 'base') { S.base = v; return render(); }
      if (b.id === 'bar') {
        var R = lastEval;
        return go(R.errs[1].length ? 1 : R.errs[2].length ? 2 : 2);
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
    // Ширина подписей окончательна только после загрузки шрифтов и раскладки
    window.addEventListener('load', revealTab);
    window.addEventListener('resize', revealTab);
    setTimeout(revealTab, 100);
  }

  init();
})();

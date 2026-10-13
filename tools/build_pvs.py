#!/usr/bin/env python3
"""Сборка базы таблиц ПВС ВМФ-2002 (приложение 4 и др.) для приложения.

Вход: HTML- и TXT-выгрузки «ПВС ВМФ-2002 - 2.doc», сделанные LibreOffice:
    soffice --headless --convert-to "html:HTML (StarWriter)" pvs.doc
    soffice --headless --convert-to "txt:Text (encoded):UTF8" pvs.doc
Запуск:
    python3 -I tools/build_pvs.py pvs.html pvs.txt app/src/main/assets/pvs.js

Итоговое время декомпрессии в базе не хранится: приложение считает его как
«переход + выдержки». Там, где напечатанный в ПВС итог расходится с суммой,
к режиму автоматически добавляется пометка. Исправления опечаток (FIXES) тоже
помечаются. Подробности — docs/pvs-errata.md.
"""
import json
import re
import sys
from html.parser import HTMLParser


# ---------- разбор HTML-таблиц ----------

class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.stack, self.cell = [], [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'table':
            self.stack.append([])
        elif tag == 'tr' and self.stack:
            self.stack[-1].append([])
        elif tag in ('td', 'th') and self.stack:
            self.cell = {'t': '', 'cs': int(a.get('colspan') or 1), 'rs': int(a.get('rowspan') or 1)}
        elif tag == 'br' and self.cell is not None:
            self.cell['t'] += ' '

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None and self.stack:
            self.cell['t'] = re.sub(r'\s+', ' ', self.cell['t']).strip()
            if self.stack[-1]:
                self.stack[-1][-1].append(self.cell)
            self.cell = None
        elif tag == 'table' and self.stack:
            self.tables.append(self.stack.pop())

    def handle_data(self, d):
        if self.cell is not None:
            self.cell['t'] += d


def grid(rows):
    """Раскрывает colspan/rowspan в прямоугольную сетку строк."""
    out, pend = [], {}
    for r, row in enumerate(rows):
        line, c, i = [], 0, 0
        while i < len(row) or (r, c) in pend:
            if (r, c) in pend:
                line.append(pend.pop((r, c)))
                c += 1
                continue
            cell = row[i]
            i += 1
            for _ in range(cell['cs']):
                line.append(cell['t'])
                for dr in range(1, cell['rs']):
                    pend[(r + dr, c)] = cell['t']
                c += 1
        out.append(line)
    return out


CELL = re.compile(r'^(\d+)\s*(?:\((\d+)\))?\s*(\*?)$')


def stop_cell(s):
    """'12 (6)*' -> (12, 6, True); '-' или '' -> None."""
    s = s.replace(' *', '*').strip()
    if s in ('', '-', '—', '–'):
        return None
    m = CELL.match(s)
    if not m:
        raise ValueError('ячейка: %r' % s)
    return int(m.group(1)), (int(m.group(2)) if m.group(2) else None), bool(m.group(3))


def hm(s):
    m = re.match(r'^(\d+)\s*(?:\((\d+)\))?$', s.strip())
    return int(m.group(1)), (int(m.group(2)) if m.group(2) else None)


def parse_column_tables(tables, idx_range):
    """Таблицы 1–3: подтаблица на глубину, экспозиции — столбцы."""
    res = {}
    for ti in idx_range:
        g = grid(tables[ti])
        label = g[0][0].replace('Глубина ', '').replace(' м', '').strip()
        depth = int(label.split('-')[-1])
        exps = [int(x) for x in g[1][2:]]
        n = len(exps)
        stops, tr, h, m = [], None, None, None
        for r in g[2:]:
            k = r[0]
            if k.startswith('Время выдержек'):
                stops.append((int(r[1]), r[2:2 + n]))
            elif k.startswith('Время перехода'):
                tr = [int(x) for x in r[2:2 + n]]
            elif k == 'ч':
                h = [hm(x) for x in r[2:2 + n]]
            elif k == 'мин':
                m = [hm(x) for x in r[2:2 + n]]
        rows = []
        for j, e in enumerate(exps):
            st = []
            for sd, vals in stops:
                c = stop_cell(vals[j])
                if c:
                    st.append([sd, c[0], c[1], 1 if c[2] else 0])
            rows.append({'e': e, 'tr': tr[j], 's': st,
                         'pa': h[j][0] * 60 + m[j][0],
                         'po': (h[j][1] * 60 + m[j][1]) if h[j][1] is not None and m[j][1] is not None else None})
        res[depth] = {'l': label.replace('-', '–'), 'r': rows}
    return res


def parse_t4(txt):
    """Таблица 4 (высокогорье) — из TXT: 25 полей в строке."""
    L = txt.split('\n')
    s = max(i for i, l in enumerate(L) if 'в условиях высокогорья с применением для дыхания воздуха и кислорода' in l)
    e = next(i for i in range(s, len(L)) if L[i].startswith('Таблица 5'))
    air_stops = [33, 30, 27, 24, 21, 18]
    o2_stops = [15, 12, 9, 6, 4, 2]
    res, depth = {}, None

    def n(x):
        x = x.strip()
        m = re.match(r'^\(?(\d+)\)?(\*?)$', x)
        return (int(m.group(1)), bool(m.group(2))) if m else (None, False)

    for ln in L[s:e]:
        f = ln.split('\t')
        if len(f) != 25 or not f[1].strip().isdigit():
            continue
        if f[0].strip():
            depth = int(f[0])
        st = []
        for k, d in enumerate(air_stops):
            v, star = n(f[3 + k])
            if v:
                st.append([d, v, None, 1 if star else 0])
        for k, d in enumerate(o2_stops):
            va, sa = n(f[9 + 2 * k])
            vo, so = n(f[10 + 2 * k])
            if va:
                st.append([d, va, vo, 1 if (sa or so) else 0])
        hA, mA, hO, mO = [x.strip() for x in f[21:25]]
        pa = (0 if hA in ('-', '') else int(hA)) * 60 + int(mA)
        po = None if mO in ('-', '') else (0 if hO in ('-', '') else int(hO)) * 60 + int(mO)
        res.setdefault(depth, {'l': str(depth), 'r': []})['r'].append(
            {'e': int(f[1]), 'tr': int(f[2]), 's': st, 'pa': pa, 'po': po})
    return res


def parse_t5(tables, ti):
    g = grid(tables[ti])
    stops_d = [int(x) for x in g[1][3:8]]
    res, depth = {}, None
    for r in g[3:]:
        if r[0].strip():
            depth = int(r[0])
        st = []
        for k, d in enumerate(stops_d):
            c = stop_cell(r[3 + k])
            if c:
                st.append([d, c[0], None, 1 if c[2] else 0])
        e = int(r[1]) if r[1].strip().isdigit() else None   # «-» — удлинённый режим за последней экспозицией
        res.setdefault(depth, {'l': str(depth), 'r': []})['r'].append(
            {'e': e, 'tr': int(r[2]), 's': st, 'pa': int(r[8]), 'po': None})
    return res


def parse_t6(tables, ti):
    g = grid(tables[ti])
    press = [float(x.replace(',', '.')) for x in g[1][3:15]]
    rows = []
    for r in g[3:]:
        mpa = float(r[0].split()[0].replace(',', '.'))
        st = [[press[k], int(v), None, 0] for k, v in enumerate(r[3:15]) if v.strip() not in ('', '-')]
        rows.append({'mpa': mpa, 'e': int(r[1]), 'tr': int(r[2]), 's': st, 'pa': int(r[15]) * 60 + int(r[16]), 'po': None})
    return rows, press


def parse_o2(tables, ti, chamber=False):
    g = grid(tables[ti])
    out = []

    def dur(s):
        s = s.replace(',', '.')
        v = float(re.match(r'[\d.]+', s).group(0))
        return round(v * 60) if ('ч' in s or chamber) else round(v)

    for r in g[2 if not chamber else 1:]:
        if not r[0].strip().isdigit():
            continue
        po2 = float(r[1].split()[0].replace(',', '.'))
        if chamber:
            out.append({'d': int(r[0]), 'po2': po2, 'max': dur(r[2])})
        else:
            out.append({'d': int(r[0]), 'po2': po2, 'light': dur(r[2]), 'heavy': dur(r[3])})
    return out


# ---------- исправления ----------
# (таблица, глубина, экспозиция): функция(row) -> текст пометки

def set_tr(v):
    def f(row):
        old = row['tr']
        row['tr'] = v
        return 'В ПВС время перехода на первую остановку напечатано %d мин; исправлено на %d мин — с ним сходятся оба итога ПВС.' % (old, v)
    return f


def set_stop(depth, air=None, o2=None):
    def f(row):
        for s in row['s']:
            if s[0] == depth:
                old = '%d%s' % (s[1], ' (%d)' % s[2] if s[2] is not None else '')
                if air is not None:
                    s[1] = air
                if o2 is not None:
                    s[2] = o2
                new = '%d%s' % (s[1], ' (%d)' % s[2] if s[2] is not None else '')
                return 'В ПВС выдержка на %d м напечатана «%s»; исправлено на «%s» — с этим значением сходятся итоги ПВС.' % (depth, old, new)
        raise KeyError(depth)
    return f


def note(text):
    return lambda row: text


TR_LONGER = 'Время перехода в ПВС ({tr} мин) не согласуется с итогами ПВС (они посчитаны с {imp} мин). Принято большее значение.'

FIXES = {
    ('t1', 38, 10): set_tr(3), ('t1', 38, 20): set_tr(3), ('t1', 38, 60): set_tr(2), ('t1', 38, 70): set_tr(2),
    ('t2_30', 18, 120): set_stop(8, o2=12),
    ('t2_30', 50, 10): set_stop(6, air=16),
    ('t2_120', 32, 60): set_stop(6, o2=10),
    ('t2_360', 40, 60): set_stop(12, air=13),
    ('t4', 42, 45): set_stop(6, air=25),
}
# Пометки к режимам, где неясно, какое число в ПВС неверно (итог считаем по выдержкам)
EXTRA = {
    ('t2_120', 48, 10): 'Остановка 10 м указана без кислородного значения, а кислородный итог ПВС её не учитывает. Принято: 2 мин на воздухе.',
    ('t2_360', 48, 10): 'Остановка 10 м указана без кислородного значения, а кислородный итог ПВС её не учитывает. Принято: 2 мин на воздухе.',
    ('t4', 60, 60): 'Оба итога ПВС на 10 мин больше суммы выдержек — вероятна опечатка в одной из выдержек. Сверьте с печатным изданием; при сомнении используйте удлинённый режим.',
}


def fmt_hm(m):
    return '%d ч %02d мин' % (m // 60, m % 60) if m >= 60 else '%d мин' % m


def finalize(name, depths):
    """Применяет исправления и добавляет пометки о расхождениях с напечатанными итогами."""
    issues = 0
    for d, dd in depths.items():
        for row in dd['r']:
            notes = []
            key = (name, d, row['e'])
            if key in FIXES:
                notes.append(FIXES[key](row))
            if key in EXTRA:
                notes.append(EXTRA[key])
            pa, po = row.pop('pa'), row.pop('po')
            has_o2 = any(s[2] is not None for s in row['s'])
            sum_air = sum(s[1] for s in row['s'])
            sum_o2 = sum((s[2] if s[2] is not None else s[1]) for s in row['s'])
            imp = pa - sum_air  # время перехода, с которым посчитан итог ПВС
            # Ошибка именно в переходе, если на неё указывают оба итога ПВС, либо (для таблиц
            # без кислородного варианта) итог посчитан с меньшим переходом, чем напечатан.
            transit_only = imp != row['tr'] and 1 <= imp <= 9 and (
                (has_o2 and po is not None and po - sum_o2 == imp) or
                (not has_o2 and imp < row['tr']))
            if transit_only:
                notes.append(TR_LONGER.format(tr=row['tr'], imp=imp))
                row['tr'] = max(row['tr'], imp)
                issues += 1
            else:
                if pa != row['tr'] + sum_air:
                    notes.append('В ПВС общее время (воздух) напечатано %s; по выдержкам — %s.'
                                 % (fmt_hm(pa), fmt_hm(row['tr'] + sum_air)))
                    issues += 1
                if po is not None and has_o2 and po != row['tr'] + sum_o2:
                    notes.append('В ПВС общее время (с кислородом) напечатано %s; по выдержкам — %s.'
                                 % (fmt_hm(po), fmt_hm(row['tr'] + sum_o2)))
                    issues += 1
            if notes:
                row['n'] = notes
    return issues


def main():
    html_path, txt_path, out_path = sys.argv[1:4]
    p = TableParser()
    p.feed(open(html_path, encoding='utf-8', errors='replace').read())
    T = p.tables
    txt = open(txt_path, encoding='utf-8').read()

    db = {
        't1': parse_column_tables(T, range(20, 45)),
        't2_30': parse_column_tables(T, range(45, 65)),
        't2_120': parse_column_tables(T, range(65, 90)),
        't2_360': parse_column_tables(T, range(90, 115)),
        't3': parse_column_tables(T, range(115, 141)),
        't4': parse_t4(txt),
        't5': parse_t5(T, 142),
    }
    # Проверка, что индексы таблиц указывают куда надо
    assert grid(T[20])[0][0] == 'Глубина 10-12 м' and grid(T[44])[0][0] == 'Глубина 60 м'
    assert grid(T[115])[0][0] == 'Глубина 10 м' and grid(T[140])[0][0] == 'Глубина 60 м'
    assert grid(T[142])[0][1].startswith('Экспозиция')

    total_notes = 0
    for name, depths in db.items():
        total_notes += finalize(name, depths)

    t6, press = parse_t6(T, 143)
    t6_notes = []
    if press[-1] == 0.5 and abs(press[-2] - 0.6) < 1e-9:
        press[-1] = 0.3
        for row in t6:
            for s in row['s']:
                if s[0] == 0.5:
                    s[0] = 0.3
        t6_notes.append('В ПВС давление последней остановки напечатано 0,5 кгс/см²; при шаге 0,3 исправлено на 0,3.')
    for row in t6:
        pa = row.pop('pa')
        row.pop('po')
        air = row['tr'] + sum(s[1] for s in row['s'])
        assert pa == air, (row, pa, air)
        row['n'] = list(t6_notes)
    db['t6'] = t6
    db['o2w'] = parse_o2(T, 145)
    db['o2c'] = parse_o2(T, 146, chamber=True)
    # json: ключи-глубины — строки
    js = 'var PVS = ' + json.dumps(db, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(out_path, 'w', encoding='utf-8').write(
        '// Таблицы ПВС ВМФ-2002. Сгенерировано tools/build_pvs.py — не править вручную.\n' + js)
    n_rows = sum(len(dd['r']) for k, v in db.items() if isinstance(v, dict) for dd in v.values())
    print('режимов: %d, пометок о расхождениях: %d, исправлений: %d' % (n_rows, total_notes, len(FIXES)))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
backtest-holders-variants.py — 「要看哪一個大戶級距」的四種判定方式比較（Franky 2026-09-12）。

背景：原本用 max(|百張 Z|, |千張 Z|)，等於同一件事問兩次、任一個說怪就算，命中率被灌水
（2.2% + 4.9% → 6.5%）。而且實測千張級距全市場人數中位數只有 10~15 人，
有些股票只有 1~2 個千張大戶，比例變化根本是單一帳戶的動作。

四種候選：
  現行  max(|Zh|, |Zk|) ≥ 門檻
  A     只看百張：|Zh| ≥ 門檻                       （人數多、數字穩，但混了中實戶）
  B     只看千張且千張人數 ≥ N：|Zk| ≥ 門檻          （保留大戶語意，擋掉單一帳戶主導）
  C     百張為主、千張佐證：|Zh| ≥ 門檻 且 千張同向動 （Franky 提的組合）

評比方式一律用「扣掉當週全市場平均」的超額報酬，並且分三段看方向有沒有翻。
進場點是資料日之後的第一個交易日（TDCC 週六才上架，週五收盤時還不知道）。

執行：
  /usr/bin/python3 scripts/backtest-holders-variants.py \
    --history /tmp/hh-prod.json --prices /tmp/hist.json --tdcc /tmp/tdcc.csv
"""

import argparse
import csv
import collections
import json
import math
import sys

import numpy as np
import pandas as pd

Z_WINDOW = 26
Z_MIN_PERIODS = 26
CAPITAL_EVENT_PCT = 0.5
MAD_TO_SIGMA = 1.4826


def robust_z(vals, floor):
    """與 production 的 calc-holders-z.mjs 同一套：中位數／MAD，只用當週之前的資料當基準。"""
    out = [None] * len(vals)
    for i, cur in enumerate(vals):
        if cur is None or (isinstance(cur, float) and math.isnan(cur)):
            continue
        base = [v for v in vals[max(0, i - Z_WINDOW):i]
                if v is not None and not (isinstance(v, float) and math.isnan(v))]
        if len(base) < Z_MIN_PERIODS:
            continue
        med = float(np.median(base))
        mad = float(np.median([abs(v - med) for v in base]))
        scale = max(MAD_TO_SIGMA * mad, floor)
        if scale <= 0:
            continue
        out[i] = (cur - med) / scale
    return out


def load_people(path):
    """當週 TDCC 原始檔的各級距人數。人數結構變化很慢，用當週值當靜態篩選是合理近似。"""
    lv = collections.defaultdict(dict)
    with open(path, encoding='utf-8-sig') as f:
        for r in csv.reader(f):
            if len(r) < 6 or not r[2].strip().isdigit():
                continue
            lv[r[1].strip()][int(r[2])] = int(r[3])
    out = {}
    for code, m in lv.items():
        if 15 in m:
            out[code] = {'k': m[15], 'h': sum(m.get(i, 0) for i in range(10, 16))}
    return out


def build(history_path, prices_path, floor):
    with open(history_path, encoding='utf-8') as f:
        weeks = sorted(json.load(f)['weeks'], key=lambda w: w['date'])
    dates = [w['date'] for w in weeks]

    recs = []
    codes = set()
    for w in weeks:
        codes |= set(w['stocks'])
    for code in codes:
        if code.startswith('00'):
            continue
        h = [w['stocks'].get(code, [None, None, None])[0] for w in weeks]
        k = [w['stocks'].get(code, [None, None, None])[1] for w in weeks]
        t = [w['stocks'].get(code, [None, None, None])[2] for w in weeks]
        dh, dk, ev = [None] * len(weeks), [None] * len(weeks), [False] * len(weeks)
        for i in range(1, len(weeks)):
            if t[i] is not None and t[i - 1]:
                ev[i] = abs(t[i] - t[i - 1]) / t[i - 1] * 100 > CAPITAL_EVENT_PCT
            if h[i] is not None and h[i - 1] is not None and not ev[i]:
                dh[i] = round(h[i] - h[i - 1], 2)
            if k[i] is not None and k[i - 1] is not None and not ev[i]:
                dk[i] = round(k[i] - k[i - 1], 2)
        zh, zk = robust_z(dh, floor), robust_z(dk, floor)
        for i, d in enumerate(dates):
            if h[i] is None:
                continue
            recs.append({'code': code, 'date': d, 'dh': dh[i], 'dk': dk[i],
                         'zh': zh[i], 'zk': zk[i], 'capital_event': ev[i]})
    p = pd.DataFrame(recs)
    p['date'] = pd.to_datetime(p['date'])

    with open(prices_path, encoding='utf-8') as f:
        pj = json.load(f)
    cal = pd.to_datetime(pj['dates'])
    order = np.argsort(cal.values)
    cal_vals = cal[order].values
    px = {c: np.array([np.nan if x is None else float(x) for x in a], dtype=float)[order]
          for c, a in pj['stocks'].items() if len(a) == len(order)}

    for col in ('ret1d', 'ret3d', 'ret1w', 'ret2w'):
        p[col] = np.nan
    for code, g in p.groupby('code', sort=False):
        a = px.get(code)
        if a is None:
            continue
        n = len(a)
        pos = np.searchsorted(cal_vals, g['date'].values, side='right')
        base = np.where(pos < n, a[np.clip(pos, 0, n - 1)], np.nan)
        base = np.where(np.isfinite(base) & (base > 0), base, np.nan)
        for col, bars in (('ret1d', 1), ('ret3d', 3), ('ret1w', 5), ('ret2w', 10)):
            t2 = pos + bars
            fwd = np.where(t2 < n, a[np.clip(t2, 0, n - 1)], np.nan)
            fwd = np.where(np.isfinite(fwd) & (fwd > 0), fwd, np.nan)
            p.loc[g.index.values, col] = (fwd - base) / base * 100
    # 市場中性化：扣掉同一個資料週的全市場等權平均
    for col in ('ret1d', 'ret3d', 'ret1w', 'ret2w'):
        p['x_' + col] = p[col] - p.groupby('date')[col].transform('mean')
    return p


def strat_test(df, mask, col):
    """分層（每檔股票一層）標籤重排的解析檢定，與 backtest-holders-patterns.py 同一套。"""
    d = df.loc[df[col].notna(), ['code', col]].copy()
    d['hit'] = mask.reindex(d.index).fillna(False).values
    n_hit = int(d['hit'].sum())
    if n_hit < 20:
        return None
    S = d.loc[d['hit'], col].sum()
    exp = var = 0.0
    for _, g in d.groupby('code', sort=False):
        Ni, ni = len(g), int(g['hit'].sum())
        if ni == 0 or Ni < 2:
            continue
        v = g[col].values
        exp += ni * v.mean()
        var += ni * (Ni - ni) * v.var(ddof=0) / (Ni - 1)
    z = (S - exp) / math.sqrt(var) if var > 0 else 0.0
    return {'n': n_hit, 'mean': float(d.loc[d['hit'], col].mean()),
            'rest': float(d.loc[~d['hit'], col].mean()),
            'diff': float(d.loc[d['hit'], col].mean() - d.loc[~d['hit'], col].mean()),
            'p': math.erfc(abs(z) / math.sqrt(2))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--history', required=True)
    ap.add_argument('--prices', required=True)
    ap.add_argument('--tdcc', required=True)
    ap.add_argument('--threshold', type=float, default=5.0)
    ap.add_argument('--floor', type=float, default=0.05)
    ap.add_argument('--min-people', type=int, default=5)
    args = ap.parse_args()

    print(f'門檻 |Z| ≥ {args.threshold}　MAD 下限 {args.floor}　千張人數下限 {args.min_people}')
    p = build(args.history, args.prices, args.floor)
    people = load_people(args.tdcc)
    p['k_people'] = p['code'].map(lambda c: people.get(c, {}).get('k', 0))
    print(f'樣本：{p["code"].nunique()} 檔 × {p["date"].nunique()} 週 = {len(p)} 筆；'
          f'可算 Z 的 {p["zh"].notna().sum()} 筆')

    th = args.threshold
    ok = ~p['capital_event']
    zh, zk = p['zh'], p['zk']
    same_up = (p['dh'] > 0) & (p['dk'] > 0)      # 兩個級距同時增加＝真的往大戶集中
    same_dn = (p['dh'] < 0) & (p['dk'] < 0)

    def variants(sign):
        """sign=+1 取集中（增加），-1 取分散（減少）"""
        s_zh, s_zk = zh * sign, zk * sign
        same = same_up if sign > 0 else same_dn
        return {
            '現行 max(百張,千張)': ok & ((s_zh >= th) | (s_zk >= th)),
            'A 只看百張': ok & (s_zh >= th),
            f'B 千張+人數≥{args.min_people}': ok & (s_zk >= th) & (p['k_people'] >= args.min_people),
            'C 百張為主+千張同向': ok & (s_zh >= th) & same,
        }

    q = pd.qcut(p['date'].rank(method='dense'), 3, labels=['前段', '中段', '後段'])
    horizons = [('x_ret1d', '次日'), ('x_ret3d', '3 日'), ('x_ret1w', '1 週'), ('x_ret2w', '2 週')]

    for sign, sname in ((1, '籌碼往大戶集中（兩個級距都增加）'), (-1, '籌碼分散（大戶減少）')):
        print('\n' + '=' * 110)
        print(f'【{sname}】進場點＝資料日之後第一個交易日；數字都是扣掉當週全市場平均的超額報酬')
        print('=' * 110)
        print('%-22s %7s %8s %s' % ('判定方式', '觸發率', '每週檔數',
                                    ''.join(f'{lab:>18}' for _, lab in horizons)))
        for name, m in variants(sign).items():
            m = m.fillna(False)
            rate = m.sum() / p['zh'].notna().sum() * 100
            cells = ''
            for col, _ in horizons:
                r = strat_test(p, m, col)
                cells += ('%18s' % '樣本不足') if r is None else \
                    ('%13s %s' % ('%+.2f%% p=%.3f' % (r['diff'], r['p']), '✅' if r['p'] < 0.05 else '—'))
            print('%-22s %6.1f%% %8.0f %s' % (name, rate, rate / 100 * 1976, cells))

        print('  分三段（1 週超額）')
        for name, m in variants(sign).items():
            m = m.fillna(False)
            cells = []
            for seg in ['前段', '中段', '後段']:
                sub = p[q == seg]
                r = strat_test(sub, m.reindex(sub.index).fillna(False), 'x_ret1w')
                cells.append('%24s' % '樣本不足' if r is None else
                             '%24s' % ('n=%-4d %+.2f p=%.3f %s' % (r['n'], r['diff'], r['p'],
                                                                   '✅' if r['p'] < 0.05 else '—')))
            print('    %-20s %s %s %s' % (name, *cells))
    return 0


    return 0


if __name__ == '__main__':
    sys.exit(main())

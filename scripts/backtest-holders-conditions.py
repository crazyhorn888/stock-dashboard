#!/usr/bin/env python3
"""
backtest-holders-conditions.py — 「籌碼集中」在什麼條件下才有效？（Franky 2026-09-13）

前情：籌碼往大戶集中之後的短線報酬，中段是正的、後段翻成負的，合併起來接近 0。
這支問的是：有沒有某個子集合（特定市值、特定位階、特定幅度…）是兩段都成立的。

⚠️ 這種切法天生就會挖到假訊號，所以先把紀律寫死在程式裡：
  1. 條件變數清單「事前」定好，跑完不再追加（下面 CONDITIONS 就是全部）
  2. 每一格都印出來，不論輸贏——不准只報贏的那幾格
  3. 只有「中段與後段同號、且兩段都 p<0.05」才列為候選；一年資料只有這兩段可測，
     前段被 Z 值的 26 週暖身吃掉了
  4. 最後印出總格數與通過數，讓讀的人自己判斷多重比較的風險

沒有納入的變數與原因：
  成交量——ohlc.json 只有 44 天，涵蓋不了 51 週的回測期間
  個股期貨——只有 270 檔有，切下去樣本不夠

執行：
  /usr/bin/python3 scripts/backtest-holders-conditions.py \
    --history /tmp/hh-prod.json --prices /tmp/hist.json --threshold 3
"""

import argparse
import json
import math
import sys

import numpy as np
import pandas as pd

Z_WINDOW = 26
Z_MIN_PERIODS = 26
CAPITAL_EVENT_PCT = 0.5
MAD_TO_SIGMA = 1.4826

# 事前定好的條件變數（跑完不追加）
CONDITIONS = [
    ('mktcap', '市值'),
    ('high_gap', '距 60 日高點'),
    ('mom4', '前 4 週漲幅'),
    ('k_level', '千張大戶比例水準'),
    ('dk_size', '本週千張增加幅度'),
    ('streak', '已連續增加週數'),
]


def robust_z(vals, floor=0.0):
    out = [None] * len(vals)
    for i, cur in enumerate(vals):
        if cur is None:
            continue
        base = [v for v in vals[max(0, i - Z_WINDOW):i] if v is not None]
        if len(base) < Z_MIN_PERIODS:
            continue
        med = float(np.median(base))
        mad = float(np.median([abs(v - med) for v in base]))
        scale = max(MAD_TO_SIGMA * mad, floor)
        if scale <= 0:
            continue
        out[i] = (cur - med) / scale
    return out


def build(history_path, prices_path, floor):
    with open(history_path, encoding='utf-8') as f:
        weeks = sorted(json.load(f)['weeks'], key=lambda w: w['date'])
    dates = [w['date'] for w in weeks]

    with open(prices_path, encoding='utf-8') as f:
        pj = json.load(f)
    cal = pd.to_datetime(pj['dates'])
    order = np.argsort(cal.values)
    cal_vals = cal[order].values
    px = {c: np.array([np.nan if x is None else float(x) for x in a], dtype=float)[order]
          for c, a in pj['stocks'].items() if len(a) == len(order)}

    codes = set()
    for w in weeks:
        codes |= set(w['stocks'])

    recs = []
    for code in sorted(codes):
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
        zh = robust_z(dh, floor)

        # 已連續增加幾週（含本週）
        streak = [0] * len(weeks)
        for i in range(len(weeks)):
            streak[i] = (streak[i - 1] + 1) if (i > 0 and dk[i] is not None and dk[i] > 0) else (
                1 if (dk[i] is not None and dk[i] > 0) else 0)

        a = px.get(code)
        for i, d in enumerate(dates):
            if h[i] is None:
                continue
            row = {'code': code, 'date': d, 'dh': dh[i], 'dk': dk[i], 'zh': zh[i],
                   'capital_event': ev[i], 'k_level': k[i], 'streak': streak[i],
                   'dk_size': dk[i], 'total': t[i]}
            if a is not None:
                pos = int(np.searchsorted(cal_vals, np.datetime64(d), side='right'))
                n = len(a)
                base = a[pos] if pos < n else np.nan
                if np.isfinite(base) and base > 0:
                    row['close'] = base
                    row['mktcap'] = base * t[i] / 1e8 if t[i] else np.nan   # 億元
                    win = a[max(0, pos - 60):pos + 1]
                    win = win[np.isfinite(win)]
                    row['high_gap'] = (base - win.max()) / win.max() * 100 if len(win) else np.nan
                    p20 = a[pos - 20] if pos - 20 >= 0 else np.nan
                    row['mom4'] = (base - p20) / p20 * 100 if np.isfinite(p20) and p20 > 0 else np.nan
                    for col, bars in (('ret1w', 5), ('ret2w', 10)):
                        j = pos + bars
                        fwd = a[j] if j < n else np.nan
                        row[col] = (fwd - base) / base * 100 if np.isfinite(fwd) and fwd > 0 else np.nan
            recs.append(row)

    p = pd.DataFrame(recs)
    p['date'] = pd.to_datetime(p['date'])
    for col in ('ret1w', 'ret2w'):
        if col not in p:
            p[col] = np.nan
        p['x_' + col] = p[col] - p.groupby('date')[col].transform('mean')
    return p


def strat_test(df, mask, col):
    d = df.loc[df[col].notna(), ['code', col]].copy()
    d['hit'] = mask.reindex(d.index).fillna(False).values
    n_hit = int(d['hit'].sum())
    if n_hit < 25:
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
    return {'n': n_hit,
            'diff': float(d.loc[d['hit'], col].mean() - d.loc[~d['hit'], col].mean()),
            'p': math.erfc(abs(z) / math.sqrt(2))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--history', required=True)
    ap.add_argument('--prices', required=True)
    ap.add_argument('--threshold', type=float, default=3.0)
    ap.add_argument('--floor', type=float, default=0.0)
    ap.add_argument('--horizon', default='x_ret1w')
    args = ap.parse_args()

    p = build(args.history, args.prices, args.floor)
    # 基準訊號：兩個級距同時增加，且百張的偏離達門檻（比 C 寬一點，切子集才有樣本）
    base = (~p['capital_event']) & (p['zh'] >= args.threshold) & (p['dh'] > 0) & (p['dk'] > 0)
    base = base.fillna(False)
    q = pd.qcut(p['date'].rank(method='dense'), 3, labels=['前段', '中段', '後段'])
    p['seg'] = q

    print(f'基準訊號：兩級距同時增加 且 百張 Z ≥ {args.threshold}　→ 全期觸發 {int(base.sum())} 次')
    print(f'評比：{args.horizon}（扣掉當週全市場平均）；只有中段與後段可測（前段被 26 週暖身吃掉）')
    print()

    tested = passed = 0
    winners = []
    for key, label in CONDITIONS:
        if key not in p or p[key].notna().sum() == 0:
            print(f'【{label}】無資料，跳過')
            continue
        vals = p.loc[base, key].dropna()
        if len(vals) < 90:
            print(f'【{label}】樣本不足，跳過')
            continue
        if key == 'streak':
            bands = [('連 1 週', (p[key] == 1)), ('連 2 週', (p[key] == 2)), ('連 3 週以上', (p[key] >= 3))]
        else:
            lo, hi = vals.quantile(1 / 3), vals.quantile(2 / 3)
            bands = [(f'低（≤{lo:.1f}）', p[key] <= lo),
                     (f'中（{lo:.1f}~{hi:.1f}）', (p[key] > lo) & (p[key] <= hi)),
                     (f'高（>{hi:.1f}）', p[key] > hi)]
        print(f'【{label}】')
        for bname, bmask in bands:
            m = (base & bmask.fillna(False))
            cells, res = [], {}
            for seg in ('中段', '後段'):
                sub = p[p['seg'] == seg]
                r = strat_test(sub, m.reindex(sub.index).fillna(False), args.horizon)
                res[seg] = r
                cells.append('樣本不足'.rjust(22) if r is None else
                             '%22s' % ('n=%-4d %+.2f p=%.3f %s' % (r['n'], r['diff'], r['p'],
                                                                   '✅' if r['p'] < 0.05 else '—')))
            tested += 1
            a, b = res['中段'], res['後段']
            ok = (a and b and a['diff'] * b['diff'] > 0 and a['p'] < 0.05 and b['p'] < 0.05)
            if ok:
                passed += 1
                winners.append(f'{label}／{bname}')
            print('  %-18s 中段 %s ｜ 後段 %s %s' % (bname, cells[0], cells[1], '★ 兩段同號且顯著' if ok else ''))
        print()

    print('=' * 78)
    print(f'總共測了 {tested} 格，通過「兩段同號且都顯著」的有 {passed} 格')
    if winners:
        print('候選：' + '、'.join(winners))
        print('⚠️ 在 %d 格裡挑出 %d 格，純靠運氣也可能發生——要當真需要用新資料再驗一次' % (tested, passed))
    else:
        print('沒有任何一格通過。切子集合救不回這個訊號。')
    return 0


if __name__ == '__main__':
    sys.exit(main())

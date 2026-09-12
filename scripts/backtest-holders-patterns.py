#!/usr/bin/env python3
"""
backtest-holders-patterns.py — 籌碼集中的「連續型態」回測（Franky 2026-09-12 提出）。

兩個問題：
  A. 大戶持股比例「連續兩週增加」之後會怎樣？
  B. 「連續兩週增加、第三週轉為減少」之後會怎樣？特別是第三週當週是不是就開始跌？

與先前 Z 值回測的三個差別：
  1. 用全市場 1,976 檔（先前只有 270 檔有個股期貨的標的）——型態不需要個股期貨資料
  2. 用原始週變化的「方向」，不碰 Z、不碰 MAD 尺度，所以與門檻／下限的爭議無關
  3. 不需要 26 週暖身，每檔可測週數從 ~26 週變成 ~48 週，樣本大很多

⚠️ 時點（先前的 Z 值回測沒處理好，這支修正了）：
   TDCC 的資料日是週五結算，週六才上架。週五收盤時根本還不知道這個數字，
   所以「進場價」必須用資料日之後的第一個交易日（通常是下週一），不能用資料日當天的收盤。
   用資料日當天會偷看到未來，讓訊號看起來比實際好。

執行：
  /usr/bin/python3 scripts/backtest-holders-patterns.py \
    --history /tmp/holders-history.json --prices /tmp/hist.json
"""

import argparse
import json
import sys

import numpy as np
import pandas as pd

CAPITAL_EVENT_PCT = 0.5
N_PERM = 4000
RNG = np.random.default_rng(20260912)


def load_history(path):
    with open(path, encoding='utf-8') as f:
        hist = json.load(f)
    weeks = sorted(hist['weeks'], key=lambda w: w['date'])
    recs = []
    for w in weeks:
        for code, v in w['stocks'].items():
            if code.startswith('00'):        # AC-HZ-3a：ETF 不適用
                continue
            recs.append({'code': code, 'date': w['date'], 'h': v[0], 'k': v[1], 'total': v[2]})
    df = pd.DataFrame(recs)
    df['date'] = pd.to_datetime(df['date'])
    return df.sort_values(['code', 'date']).reset_index(drop=True)


def load_prices(path):
    """回傳 (共用交易日曆, {code: 對齊日曆的價格陣列，缺值為 nan})。

    ⚠️ 不能用每檔自己 dropna 後的序列去數「往後 20 筆」：資料稀疏的小型股，
    20 筆可能橫跨好幾個月，那根本不是 4 週。一律用全市場共用日曆定位，
    起點與終點都必須在該股有價格才算數。
    """
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    dates = pd.to_datetime(d['dates'])
    order = np.argsort(dates.values)
    cal = dates[order]
    out = {}
    for code, arr in d['stocks'].items():
        a = np.array([np.nan if x is None else float(x) for x in arr], dtype=float)
        if len(a) != len(order):
            continue
        out[code] = a[order]
    return cal, out


def build_panel(hist, prices):
    parts = []
    for code, g in hist.groupby('code', sort=False):
        g = g.sort_values('date').copy()
        for col in ('h', 'k'):
            g[f'd{col}'] = g[col].diff()
        g['capital_event'] = (g['total'].pct_change() * 100).abs() > CAPITAL_EVENT_PCT
        # 股本事件週的變化不可比，方向一律視為未知
        for col in ('dh', 'dk'):
            g[col] = g[col].where(~g['capital_event'])
        parts.append(g)
    p = pd.concat(parts, ignore_index=True)

    # ⚠️ 進場點＝資料日之後的第一個交易日（週六上架，最快週一才能動作）。
    # 逐列 .at 指派在 10 萬列會慢到不能用，改成每檔一次 searchsorted 的向量寫法。
    for col in ('ret0w', 'ret1w', 'ret2w', 'ret4w'):
        p[col] = np.nan

    cal, px = prices
    cal_vals = cal.values
    for code, g in p.groupby('code', sort=False):
        a = px.get(code)
        if a is None:
            continue
        # 共用日曆上「嚴格大於資料日」的第一格
        pos = np.searchsorted(cal_vals, g['date'].values, side='right')
        idx = g.index.values
        n = len(a)
        ok = pos < n
        safe = np.clip(pos, 0, n - 1)
        base = np.where(ok, a[safe], np.nan)
        base = np.where(np.isfinite(base) & (base > 0), base, np.nan)

        prev = np.where(ok & (pos - 1 >= 0), a[np.clip(pos - 1, 0, n - 1)], np.nan)
        prev = np.where(np.isfinite(prev) & (prev > 0), prev, np.nan)
        p.loc[idx, 'ret0w'] = (base - prev) / prev * 100

        for col, bars in (('ret1w', 5), ('ret2w', 10), ('ret4w', 20)):
            t = pos + bars
            t_ok = t < n
            fwd = np.where(t_ok, a[np.clip(t, 0, n - 1)], np.nan)
            fwd = np.where(np.isfinite(fwd) & (fwd > 0), fwd, np.nan)
            p.loc[idx, col] = (fwd - base) / base * 100
    return p


def add_patterns(p, col):
    """col = 'dh'（百張）或 'dk'（千張）"""
    g = p.groupby('code', sort=False)[col]
    d0 = p[col]
    d1 = g.shift(1)
    d2 = g.shift(2)
    up2 = (d1 > 0) & (d0 > 0)                      # A：連續兩週增加（本週是第二週）
    up2_then_down = (d2 > 0) & (d1 > 0) & (d0 < 0) # B：兩週增加後第三週轉減（本週是第三週）
    return up2.fillna(False), up2_then_down.fillna(False)


def perm_test(panel, mask, value_col, n=N_PERM):
    """型態組 vs 其餘，標籤只在同一檔股票內重排。

    直接跑 4,000 次重排要對 2,000 檔 × 10 萬列做迴圈，實測跑不完。改用等價的解析解：
    分層（每檔股票一層）無放回抽樣下，型態組總和 S 的期望值與變異數有封閉解
      E[S]  = Σ n_i·μ_i
      Var[S] = Σ n_i(N_i−n_i)/(N_i−1)·σ_i²
    而「兩組均值差」是 S 的線性函數，所以用 z =(S−E[S])/sd(S) 取雙尾 p 值，
    與重排檢定問的是同一件事（只差在用常態近似取代經驗分布）。
    """
    d = panel.loc[panel[value_col].notna(), ['code', value_col]].copy()
    d['hit'] = mask.reindex(d.index).fillna(False).values
    n_hit = int(d['hit'].sum())
    if n_hit < 20 or len(d) < 200:
        return None

    tot_n = len(d)
    S = d.loc[d['hit'], value_col].sum()
    exp = var = 0.0
    for _, g in d.groupby('code', sort=False):
        Ni = len(g)
        ni = int(g['hit'].sum())
        if ni == 0 or Ni < 2:
            continue
        v = g[value_col].values
        mu = v.mean()
        sig2 = v.var(ddof=0)
        exp += ni * mu
        # 無放回抽樣下 Var(Σ) = n(N−n)σ²/(N−1)，σ² 用母體變異數（ddof=0）
        var += ni * (Ni - ni) * sig2 / (Ni - 1)
    sd = np.sqrt(var)
    z = (S - exp) / sd if sd > 0 else 0.0
    # 雙尾常態 p（不用 scipy：erfc）
    import math
    p_val = math.erfc(abs(z) / math.sqrt(2))

    hit_mean = d.loc[d['hit'], value_col].mean()
    rest_mean = d.loc[~d['hit'], value_col].mean()
    return {'n_hit': n_hit, 'n_rest': tot_n - n_hit,
            'mean_hit': float(hit_mean), 'mean_rest': float(rest_mean),
            'diff': float(hit_mean - rest_mean), 'p': float(p_val), 'z': float(z),
            'win_hit': float((d.loc[d['hit'], value_col] > 0).mean() * 100),
            'win_rest': float((d.loc[~d['hit'], value_col] > 0).mean() * 100)}


def line(label, r):
    if r is None:
        return f'  {label:<16} 樣本不足'
    star = '✅' if r['p'] < 0.05 else '—'
    return (f'  {label:<16} 型態 {r["mean_hit"]:+.2f}%（n={r["n_hit"]}，勝率 {r["win_hit"]:.0f}%）'
            f'　其餘 {r["mean_rest"]:+.2f}%（勝率 {r["win_rest"]:.0f}%）'
            f'　差 {r["diff"]:+.2f}　p={r["p"]:.4f} {star}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--history', required=True)
    ap.add_argument('--prices', required=True)
    ap.add_argument('--min-pp', type=float, default=0.0,
                    help='每週增加至少要 X pp 才算（預設 0 = 只看方向）')
    args = ap.parse_args()

    print('讀檔 …', flush=True)
    hist = load_history(args.history)
    print(f'  股權分散：{hist["code"].nunique()} 檔 × {hist["date"].nunique()} 週，'
          f'{hist["date"].min().date()} ~ {hist["date"].max().date()}')
    prices = load_prices(args.prices)
    print(f'  價格：{len(prices[1])} 檔，共用日曆 {len(prices[0])} 個交易日')
    panel = build_panel(hist, prices)
    has_ret = panel['ret4w'].notna().sum()
    print(f'  可測股票週：{len(panel)}（其中 {has_ret} 筆有 4 週後報酬）')
    print(f'  進場點：資料日之後第一個交易日（避免偷看未來）')

    for col, name in (('dk', '千張大戶'), ('dh', '百張大戶')):
        up2, up2down = add_patterns(panel, col)
        if args.min_pp > 0:
            g = panel.groupby('code', sort=False)[col]
            up2 &= (panel[col] >= args.min_pp) & (g.shift(1) >= args.min_pp)
            up2down &= (g.shift(1) >= args.min_pp) & (g.shift(2) >= args.min_pp)

        print('\n' + '=' * 96)
        print(f'【{name}】A：連續兩週增加（本週＝第二週，進場在資料日之後）'
              f'　出現 {int(up2.sum())} 次（佔 {up2.mean() * 100:.1f}%）')
        print('=' * 96)
        for c, lab in (('ret0w', '上架跳空'), ('ret1w', '1 週後'), ('ret2w', '2 週後'), ('ret4w', '4 週後')):
            print(line(lab, perm_test(panel, up2, c)))

        print('\n' + '=' * 96)
        print(f'【{name}】B：連續兩週增加後、第三週轉為減少（本週＝第三週）'
              f'　出現 {int(up2down.sum())} 次（佔 {up2down.mean() * 100:.1f}%）')
        print('=' * 96)
        for c, lab in (('ret0w', '上架跳空'), ('ret1w', '1 週後'), ('ret2w', '2 週後'), ('ret4w', '4 週後')):
            print(line(lab, perm_test(panel, up2down, c)))

        # B 的對照組：同樣是「本週減少」，但前面沒有連兩週增加——分得出是型態還是單純的減少
        g = panel.groupby('code', sort=False)[col]
        plain_down = (panel[col] < 0) & ~up2down
        print(f'\n  對照｜單純本週減少（前面沒有連兩週增加）出現 {int(plain_down.sum())} 次')
        for c, lab in (('ret1w', '1 週後'), ('ret4w', '4 週後')):
            print(line(lab, perm_test(panel, plain_down, c)))

    return 0


if __name__ == '__main__':
    sys.exit(main())

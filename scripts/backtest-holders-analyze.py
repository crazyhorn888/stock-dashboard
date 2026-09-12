#!/usr/bin/env python3
"""
backtest-holders-analyze.py — AC-BT-3/4/5：集保大戶「籌碼異常」的回測。

輸入（都由前兩支腳本產出，全部在暫存目錄）：
  --holders  backtest-holders-fetch.py 的 JSONL
  --ssf      backtest-ssf-fetch.py 的 ssf-daily.json
  --prices   dashboard 的 history.json（Supabase 上那份，250 個交易日對齊共用日曆）

回答兩個問題：
  BT-3 異常週的前一週，個股期貨有沒有先動？（OI 變化 Z、成交量 Z、前十大買方集中度變化）
  BT-4 異常之後 1／2／4 週的報酬，跟同期全樣本基準比有沒有差？

顯著性：異常標籤在「同一檔股票內」隨機重排 5,000 次（permutation test），
比對真實差異落在重排分布的哪個位置。這樣做才不會把「大型股本來就漲比較多」
當成訊號——重排只打亂時間，不跨股票。

⚠️ 樣本限制：TDCC 只保留 51 週，扣掉 Z 值要用的滾動窗，每檔實際可測約 24～38 週。
docs/backlog.md 那套「三段互不重疊、每段都要贏」的標準是為 1,600 天的大盤序列設計的，
這裡只有一年，三段各約 17 週，單段的統計力本來就弱——結論要照這個限制寫。
"""

import argparse
import json
import sys

import numpy as np
import pandas as pd

def roll_z(series, window, min_periods, robust):
    """滾動 Z 值。基準只用「當週之前」的資料（shift(1)），不能讓當週自己進基準。

    robust=True 時用中位數與 MAD 取代平均數與標準差。2026-09-11 實測：大戶持股比例的
    週變化峰度高達 640（常態是 0），一根極端值會把標準差撐大、把後面真正的異常壓成
    小 Z；|Z|≥2 的命中率因此變成 14.5%（常態下應該是 4.6%）。MAD 不受單點極端值影響。
    """
    base = series.shift(1)
    if not robust:
        mu = base.rolling(window, min_periods=min_periods).mean()
        sd = base.rolling(window, min_periods=min_periods).std()
        return (series - mu) / sd.replace(0, np.nan)
    # MAD 必須在「同一個窗」裡算：median(|x − median(x)|)。
    # 先算滾動中位數再對差值做第二次 rolling 是錯的——那會把 MAD 抹平並往後延 26 期，
    # min_periods 拉到 26 時整條序列會變成全 NaN（2026-09-11 與 JS 版對帳時抓到）。
    def _mad(x):
        m = np.median(x)
        return np.median(np.abs(x - m))
    med = base.rolling(window, min_periods=min_periods).median()
    mad = base.rolling(window, min_periods=min_periods).apply(_mad, raw=True)
    return (series - med) / (1.4826 * mad).replace(0, np.nan)


Z_WINDOW = 26          # AC-HZ-2：Z 值滾動窗（週）
Z_MIN_PERIODS = 12     # 一年樣本下放寬，否則可測週數會少一半（與 production 的差異要寫進報告）
CAPITAL_EVENT_PCT = 0.5   # AC-HZ-3：總股數週變化超過這個 % 就當股本／庫存事件
Z_THRESHOLD = 2.0      # AC-HZ-4
N_PERM = 5000
RNG = np.random.default_rng(20260911)


# ── 讀檔 ────────────────────────────────────────────────────────────────

def load_holders(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get('h') is None:
                continue
            rows.append(r)
    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(df['date'], format='%Y%m%d')
    return df.sort_values(['code', 'date']).reset_index(drop=True)


def drop_etf(df):
    """ETF（代號 00 開頭）不適用這套判定。

    2026-09-11 實測：ETF 每週都有申購／買回，總股數週週在動，AC-HZ-3 的股本事件守門
    會把整檔股票的每一週都判成不可比，Z 值永遠算不出來。而且 ETF 的「千張大戶」是
    造市商與保管銀行的庫存，跟普通股「大股東在加碼還是出貨」根本是兩件事。
    """
    return df[~df['code'].str.startswith('00')].copy()


def load_ssf(path):
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    recs = []
    for code, days in d['stocks'].items():
        for dt, v in days.items():
            recs.append({'code': code, 'date': dt, 'oi': v.get('oi'), 'vol': v.get('vol'),
                         'buy10': v.get('buy10'), 'sell10': v.get('sell10')})
    df = pd.DataFrame(recs)
    df['date'] = pd.to_datetime(df['date'])
    return df.sort_values(['code', 'date']).reset_index(drop=True)


def load_prices(path):
    """(共用交易日曆, {code: 對齊日曆的價格陣列})。

    ⚠️ 2026-09-12 修正兩個錯：
      1. 不能用每檔自己 dropna 後的序列數「往後 20 筆」——資料稀疏的小型股會橫跨好幾個月。
      2. 進場價不能用資料日當天收盤：TDCC 週五結算、週六才上架，週五收盤時還不知道這個數字。
    """
    with open(path, encoding='utf-8') as f:
        d = json.load(f)
    dates = pd.to_datetime(d['dates'])
    order = np.argsort(dates.values)
    cal = dates[order]
    out = {}
    for code, arr in d['stocks'].items():
        a = np.array([np.nan if x is None else float(x) for x in arr], dtype=float)
        if len(a) == len(order):
            out[code] = a[order]
    return cal, out


# ── AC-HZ：週變化、股本事件、Z 值 ────────────────────────────────────────

def build_holder_features(df, robust=True):
    parts = []
    for code, g in df.groupby('code', sort=False):
        g = g.sort_values('date').copy()
        g['dh'] = g['h'].diff()
        g['dk'] = g['k'].diff()
        g['dtotal_pct'] = g['total'].pct_change() * 100
        g['capital_event'] = g['dtotal_pct'].abs() > CAPITAL_EVENT_PCT

        # AC-HZ-3：股本事件那幾週不參與 Z 的基準計算，也不自己亮燈
        for col in ('dh', 'dk'):
            # 股本事件週在 clean 裡是 NaN，所以它既不會進基準窗、自己的 Z 也是 NaN，
            # 剛好就是 AC-HZ-3 要的行為（那一週不可比、不亮燈）
            clean = g[col].where(~g['capital_event'])
            g[f'z_{col}'] = roll_z(clean, Z_WINDOW, Z_MIN_PERIODS, robust)
        parts.append(g)

    out = pd.concat(parts, ignore_index=True)
    hit = (out['z_dh'].abs() >= Z_THRESHOLD) | (out['z_dk'].abs() >= Z_THRESHOLD)
    out['anomaly'] = hit.fillna(False) & ~out['capital_event']
    # 方向以千張為主（更貼近「大戶」語意），千張缺值才看百張
    dirz = out['z_dk'].where(out['z_dk'].abs() >= Z_THRESHOLD, out['z_dh'])
    out['direction'] = np.sign(dirz).where(out['anomaly'])
    return out


# ── AC-BT-3：把個股期貨的日資料摺成「以集保週別為界」的週特徵 ───────────

def build_ssf_weekly(holders, ssf, robust=True, min_oi=200_000):
    """對每個 (code, 集保資料日) 算出該週的期貨特徵，再取各自的 Z。"""
    weeks = holders[['code', 'date']].drop_duplicates().sort_values(['code', 'date'])
    ssf_idx = {code: g.set_index('date') for code, g in ssf.groupby('code', sort=False)}

    recs = []
    for code, g in weeks.groupby('code', sort=False):
        s = ssf_idx.get(code)
        if s is None:
            continue
        dates = list(g['date'])
        for i, d in enumerate(dates):
            prev = dates[i - 1] if i > 0 else None
            win = s.loc[(s.index <= d) & (s.index > (prev if prev is not None else d - pd.Timedelta(days=7)))]
            if win.empty:
                continue
            oi_end = win['oi'].iloc[-1]
            oi_start = win['oi'].iloc[0]
            # OI 週變化不能用單純比率：小 OI 的股票從 1 口變 1,855 口就是 1,854 倍，
            # 2026-09-11 實測最大值真的到 1854.5，Z 值整條被這種列帶歪（全樣本均值 0.645，
            # 理論上該接近 0）。改成用「該股自己的 OI 中位數」當分母，再擋掉 OI 太小的股票。
            scale = s['oi'].median()
            recs.append({
                'code': code, 'date': d,
                'oi_end': oi_end,
                'oi_scale': scale,
                'oi_chg': (oi_end - oi_start) / scale if scale and scale >= min_oi else np.nan,
                'vol': win['vol'].sum(),
                'buy10': win['buy10'].dropna().iloc[-1] if win['buy10'].notna().any() else np.nan,
                'sell10': win['sell10'].dropna().iloc[-1] if win['sell10'].notna().any() else np.nan,
            })

    w = pd.DataFrame(recs)
    if w.empty:
        return w
    parts = []
    for code, g in w.groupby('code', sort=False):
        g = g.sort_values('date').copy()
        g['buy10_chg'] = g['buy10'].diff()
        for col in ('oi_chg', 'vol', 'buy10_chg'):
            g[f'z_{col}'] = roll_z(g[col], Z_WINDOW, Z_MIN_PERIODS, robust)
        parts.append(g)
    return pd.concat(parts, ignore_index=True)


# ── AC-BT-4：異常之後的報酬 ──────────────────────────────────────────────

def attach_returns(panel, prices):
    cal, px = prices
    cal_vals = cal.values
    for col in ('ret1w', 'ret2w', 'ret4w'):
        panel[col] = np.nan

    for code, g in panel.groupby('code', sort=False):
        a = px.get(code)
        if a is None:
            continue
        n = len(a)
        # 嚴格大於資料日的第一個交易日才是可以動作的時點
        pos = np.searchsorted(cal_vals, g['date'].values, side='right')
        idx = g.index.values
        ok = pos < n
        base = np.where(ok, a[np.clip(pos, 0, n - 1)], np.nan)
        base = np.where(np.isfinite(base) & (base > 0), base, np.nan)
        for col, bars in (('ret1w', 5), ('ret2w', 10), ('ret4w', 20)):
            t = pos + bars
            fwd = np.where(t < n, a[np.clip(t, 0, n - 1)], np.nan)
            fwd = np.where(np.isfinite(fwd) & (fwd > 0), fwd, np.nan)
            panel.loc[idx, col] = (fwd - base) / base * 100

    # 市場中性化：扣掉同一個資料週的全市場等權平均，排除「型態剛好撞到崩盤週」的假訊號
    for col in ('ret1w', 'ret2w', 'ret4w'):
        panel['x_' + col] = panel[col] - panel.groupby('date')[col].transform('mean')
    return panel


# ── 統計 ────────────────────────────────────────────────────────────────

def perm_test(panel, value_col, label_col='anomaly', n=N_PERM):
    """異常組與其餘的均值差；標籤只在同一檔股票內重排，避免跨股結構被當成訊號。"""
    d = panel[['code', label_col, value_col]].dropna()
    if d[label_col].sum() < 10 or len(d) < 100:
        return None
    observed = d.loc[d[label_col], value_col].mean() - d.loc[~d[label_col], value_col].mean()

    groups = [(g[label_col].values.copy(), g[value_col].values) for _, g in d.groupby('code', sort=False)]
    diffs = np.empty(n)
    for i in range(n):
        hit_sum = hit_cnt = rest_sum = rest_cnt = 0.0
        for lab, val in groups:
            if lab.sum() == 0:
                rest_sum += val.sum(); rest_cnt += len(val)
                continue
            perm = RNG.permutation(lab)
            hit_sum += val[perm].sum(); hit_cnt += perm.sum()
            rest_sum += val[~perm].sum(); rest_cnt += len(val) - perm.sum()
        diffs[i] = (hit_sum / hit_cnt if hit_cnt else np.nan) - (rest_sum / rest_cnt if rest_cnt else np.nan)

    p = float((np.abs(diffs) >= abs(observed)).mean())
    return {
        'n_hit': int(d[label_col].sum()), 'n_rest': int((~d[label_col]).sum()),
        'mean_hit': float(d.loc[d[label_col], value_col].mean()),
        'mean_rest': float(d.loc[~d[label_col], value_col].mean()),
        'diff': float(observed), 'p': p,
    }


def fmt(res, label, unit=''):
    if res is None:
        return f'  {label:<22} 樣本不足，不檢定'
    star = '✅' if res['p'] < 0.05 else '—'
    return (f'  {label:<22} 異常組 {res["mean_hit"]:+.3f}{unit}（n={res["n_hit"]}）'
            f'　其餘 {res["mean_rest"]:+.3f}{unit}（n={res["n_rest"]}）'
            f'　差 {res["diff"]:+.3f}　p={res["p"]:.4f} {star}')


def main():
    global Z_THRESHOLD
    ap = argparse.ArgumentParser()
    ap.add_argument('--holders', required=True)
    ap.add_argument('--ssf', required=True)
    ap.add_argument('--prices', required=True)
    ap.add_argument('--out', default=None, help='把 panel 存成 CSV 方便再分析')
    ap.add_argument('--keep-etf', action='store_true', help='不要排除 ETF（預設排除，見 drop_etf）')
    ap.add_argument('--classic', action='store_true', help='用平均數/標準差版 Z（預設是中位數/MAD 穩健版）')
    ap.add_argument('--threshold', type=float, default=Z_THRESHOLD, help='異常門檻（預設 2.0）')
    args = ap.parse_args()

    print('讀檔 …', flush=True)
    holders = load_holders(args.holders)
    if not args.keep_etf:
        before = holders['code'].nunique()
        holders = drop_etf(holders)
        print(f'  排除 ETF：{before} → {holders["code"].nunique()} 檔')
    print(f'  股權分散：{holders["code"].nunique()} 檔 × {holders["date"].nunique()} 週，'
          f'{holders["date"].min().date()} ~ {holders["date"].max().date()}')

    Z_THRESHOLD = args.threshold
    robust = not args.classic
    print(f'  Z 版本：{"穩健（中位數/MAD）" if robust else "傳統（平均/標準差）"}　門檻 {Z_THRESHOLD}')
    feats = build_holder_features(holders, robust=robust)
    testable = feats['z_dk'].notna().sum()
    print(f'  可測週數（Z 值有值）：{testable}　'
          f'股本事件週：{int(feats["capital_event"].sum())}　'
          f'異常週：{int(feats["anomaly"].sum())}'
          f'（加碼 {int((feats["direction"] > 0).sum())}／出貨 {int((feats["direction"] < 0).sum())}）')

    ssf = load_ssf(args.ssf)
    print(f'  個股期貨：{ssf["code"].nunique()} 檔 × {ssf["date"].nunique()} 個交易日')
    weekly = build_ssf_weekly(feats, ssf, robust=robust)

    panel = feats.merge(weekly.drop(columns=['buy10', 'sell10'], errors='ignore'),
                        on=['code', 'date'], how='left')

    # BT-3 問的是「異常週的前一週」，所以期貨特徵要往後推一格對上異常週
    for col in ('z_oi_chg', 'z_vol', 'z_buy10_chg'):
        panel[f'prev_{col}'] = panel.groupby('code', sort=False)[col].shift(1)

    prices = load_prices(args.prices)
    print(f'  價格序列：{len(prices[1])} 檔，共用日曆 {len(prices[0])} 天')
    panel = attach_returns(panel, prices)

    print('\n' + '=' * 78)
    print('AC-BT-3　異常週的「前一週」，個股期貨有沒有先動？')
    print('=' * 78)
    for col, label, unit in (
        ('prev_z_oi_chg', '前一週 OI 變化 Z', ''),
        ('prev_z_vol', '前一週 成交量 Z', ''),
        ('prev_z_buy10_chg', '前一週 前十大買方集中度 Z', ''),
    ):
        print(fmt(perm_test(panel, col), label, unit))

    print('\n  同週對照（不是 BT-3 的問題，但能看出是同步還是領先）：')
    for col, label in (('z_oi_chg', '同週 OI 變化 Z'), ('z_vol', '同週 成交量 Z')):
        print(fmt(perm_test(panel, col), label))

    print('\n' + '=' * 78)
    print('AC-BT-4　異常之後的報酬（%，對同期其餘樣本）')
    print('=' * 78)
    for col, label in (('ret1w', '1 週後'), ('ret2w', '2 週後'), ('ret4w', '4 週後')):
        print(fmt(perm_test(panel, col), label, '%'))
        print(fmt(perm_test(panel, 'x_' + col), f'{label}（扣市場）', '%'))

    print('\n  分方向看（加碼 vs 出貨，各自對其餘樣本）：')
    for sign, name in ((1, '大戶加碼'), (-1, '大戶出貨')):
        sub = panel.copy()
        sub['anomaly'] = sub['anomaly'] & (sub['direction'] == sign)
        for col, label in (('ret1w', '1 週後'), ('ret4w', '4 週後')):
            print(fmt(perm_test(sub, 'x_' + col), f'{name} {label}（扣市場）', '%'))

    print('\n' + '=' * 78)
    print('AC-BT-5　分三段期間（各約 17 週）')
    print('=' * 78)
    edges = pd.qcut(panel['date'].rank(method='dense'), 3, labels=['前段', '中段', '後段'])
    panel['segment'] = edges
    for seg in ['前段', '中段', '後段']:
        sub = panel[panel['segment'] == seg]
        rng = f'{sub["date"].min().date()} ~ {sub["date"].max().date()}'
        print(f'\n  【{seg}】{rng}　異常 {int(sub["anomaly"].sum())} 次')
        for col, label in (('prev_z_oi_chg', '前一週 OI 變化 Z'), ('x_ret4w', '4 週後報酬（扣市場）')):
            print('  ' + fmt(perm_test(sub, col), label))

    if args.out:
        panel.to_csv(args.out, index=False)
        print(f'\npanel 已存 {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

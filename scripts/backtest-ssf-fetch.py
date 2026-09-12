#!/usr/bin/env python3
"""
backtest-ssf-fetch.py — AC-BT-2：抓個股期貨歷史（行情 + 大額交易人），給回測用。

三個資料源都不進 production，只落在暫存目錄：
  1. 年度行情：POST futDataDown  down_type=2&his_year=YYYY  → 一年份全商品 zip（~9.7MB）
  2. 當年月檔：POST futDataDown  down_type=1&commodity_id=all&queryStartDate/EndDate
     （官方限制一次不得超過一個月，所以今年要逐月抓）
  3. 大額交易人：POST largeTraderFutQry  contractId=all  → 一天一次，全契約一次拿回
     （逐契約查要 320×250 = 8 萬次；contractId=all 只要 250 次）

個股期貨一檔股票可能有「標準」與「小型」兩個契約（320 契約 → 270 檔股票），
口數不能直接相加：標準 1 口 = 2,000 股、小型 1 口 = 100 股，一律換成股數再加總。

    python3 scripts/backtest-ssf-fetch.py --out-dir /tmp/ssf --years 2025 --months 2026-01:2026-09
"""

import argparse
import csv
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import date, timedelta

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
DOWN = 'https://www.taifex.com.tw/cht/3/futDataDown'
DOWN_REF = 'https://www.taifex.com.tw/cht/3/dlFutDailyMarketView'
LT = 'https://www.taifex.com.tw/cht/3/largeTraderFutQry'
SSF_LIST = 'https://openapi.taifex.com.tw/v1/SSFLists'
MARGIN = 'https://openapi.taifex.com.tw/v1/SingleStockFuturesMargining'

# 契約規模（股／口）。ContractName 以「小型」開頭的是小型契約
LOT_STANDARD = 2000
LOT_MINI = 100


def post(url, data, referer, timeout=180, retries=3):
    body = urllib.parse.urlencode(data).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers={
                'User-Agent': UA, 'Referer': referer,
                'Content-Type': 'application/x-www-form-urlencoded',
            })
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read()
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(3 * (attempt + 1))


def get_json(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode('utf-8'))


def build_contract_map():
    """contract code → (stock_code, 股數/口, 契約中文名)。名稱來自保證金表（有「小型」字樣）。"""
    lists = get_json(SSF_LIST)
    margin = {r['Contract'].strip(): r for r in get_json(MARGIN)}
    out = {}
    for r in lists:
        c = r['Contract'].strip()
        name = (margin.get(c, {}).get('ContractName') or '').strip()
        lot = LOT_MINI if name.startswith('小型') else LOT_STANDARD
        out[c] = (r['StockCode'].strip(), lot, name or c)
    return out


def iter_market_rows(raw_csv_bytes):
    """解析期貨行情 CSV（Big5），連交易時段一起吐出。

    盤後時段的列未沖銷量一律是 0（2026-09-10 實測 CDF/QFF 皆然），成交量則是獨立的一筆。
    所以未沖銷量只能取一般時段（取兩段會重複計），成交量兩段都要加（盤後是真的流量）。
    """
    text = raw_csv_bytes.decode('big5', errors='ignore')
    rdr = csv.reader(io.StringIO(text))
    header = next(rdr, None)
    if not header:
        return
    idx = {name.strip(): i for i, name in enumerate(header)}
    need = ['交易日期', '契約', '成交量', '未沖銷契約數', '交易時段']
    if any(n not in idx for n in need):
        raise SystemExit(f'❌ 欄位名對不上，實際表頭：{header}')
    for row in rdr:
        if len(row) <= idx['交易時段']:
            continue
        yield (row[idx['交易日期']].strip().replace('/', '-'),
               row[idx['契約']].strip(),
               row[idx['成交量']].strip(),
               row[idx['未沖銷契約數']].strip(),
               row[idx['交易時段']].strip())


def to_int(s):
    s = (s or '').replace(',', '').strip()
    if not s or s in ('-', '--'):
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def fetch_market(out_dir, years, months, cmap):
    """回傳 {date: {stock: {'oi': 股數, 'vol': 股數}}}"""
    agg = {}

    def absorb(raw):
        for d, contract, vol, oi, session in iter_market_rows(raw):
            m = cmap.get(contract)
            if not m:
                continue
            stock, lot, _ = m
            slot = agg.setdefault(d, {}).setdefault(stock, {'oi': 0, 'vol': 0})
            if session == '一般':
                slot['oi'] += to_int(oi) * lot
            slot['vol'] += to_int(vol) * lot

    for y in years:
        cache = os.path.join(out_dir, f'fut_{y}.zip')
        if not os.path.exists(cache):
            print(f'  下載年度行情 {y} …', flush=True)
            raw = post(DOWN, {'down_type': '2', 'his_year': str(y)}, DOWN_REF)
            with open(cache, 'wb') as f:
                f.write(raw)
        with zipfile.ZipFile(cache) as z:
            name = z.namelist()[0]
            print(f'  解析 {name}', flush=True)
            absorb(z.read(name))

    for ym in months:
        cache = os.path.join(out_dir, f'fut_{ym}.csv')
        if not os.path.exists(cache):
            y, m = int(ym[:4]), int(ym[5:7])
            start = date(y, m, 1)
            end = (date(y + (m == 12), (m % 12) + 1, 1) - timedelta(days=1))
            print(f'  下載月檔 {ym} …', flush=True)
            raw = post(DOWN, {
                'down_type': '1', 'commodity_id': 'all', 'commodity_id2': '',
                'queryStartDate': start.strftime('%Y/%m/%d'),
                'queryEndDate': end.strftime('%Y/%m/%d'),
            }, DOWN_REF)
            with open(cache, 'wb') as f:
                f.write(raw)
            time.sleep(2)
        with open(cache, 'rb') as f:
            absorb(f.read())

    return agg


LT_NUM = re.compile(r'^([\d,]+)')


def parse_large_trader(html):
    """回傳 {契約中文名: {'buy10_pct': x, 'sell10_pct': y, 'market_oi': n}}（取全市場OI最大的那列）。"""
    out = {}
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S)
    for r in rows:
        cells = [re.sub(r'\s+', '', re.sub(r'<[^>]+>', '', c))
                 for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', r, re.S)]
        if len(cells) < 11:
            continue
        name = cells[0]
        if not name or '契約名稱' in name:
            continue

        def pct(s):
            m = re.match(r'^([\d.]+)%', s)
            return float(m.group(1)) if m else None

        buy10 = pct(cells[5])
        sell10 = pct(cells[9])
        moi = LT_NUM.match(cells[10])
        moi = int(moi.group(1).replace(',', '')) if moi else 0
        if buy10 is None or sell10 is None:
            continue
        prev = out.get(name)
        if prev is None or moi > prev['market_oi']:
            out[name] = {'buy10_pct': buy10, 'sell10_pct': sell10, 'market_oi': moi}
    return out


def fetch_large_trader(out_dir, dates, cmap, sleep=1.0):
    """回傳 {date: {stock: {'buy10': %, 'sell10': %}}}；同股多契約取全市場OI較大的那個契約。"""
    cache_path = os.path.join(out_dir, 'large-trader.json')
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path, encoding='utf-8') as f:
            cache = json.load(f)

    # 一檔股票可能有標準與小型兩個契約，集中度必須固定取同一個契約，否則序列會在
    # 「今天哪個契約 OI 比較大」之間跳來跳去，Z 值量到的是契約切換不是籌碼變化。
    # 一律優先取標準契約（法人部位在那裡），只有小型的才退而求其次。
    name_to_stock = {}
    for c, (stock, lot, name) in cmap.items():
        name_to_stock[name] = (stock, lot == LOT_STANDARD)

    todo = [d for d in dates if d not in cache]
    print(f'  大額交易人：共 {len(dates)} 個交易日，待抓 {len(todo)}', flush=True)
    for i, d in enumerate(todo):
        try:
            raw = post(LT, {'queryDate': d.replace('-', '/'), 'contractId': 'all',
                            'contractId2': '', 'datecount': ''}, LT, timeout=90)
            parsed = parse_large_trader(raw.decode('utf-8', errors='ignore'))
        except Exception as e:
            print(f'  ⚠️ {d} 失敗：{e}', file=sys.stderr, flush=True)
            continue

        day = {}
        for name, v in parsed.items():
            hit = name_to_stock.get(name)
            if not hit:
                continue
            stock, is_standard = hit
            prev = day.get(stock)
            # 標準契約一律勝出；同級才比全市場未沖銷量
            if prev is None or (is_standard, v['market_oi']) > (prev['std'], prev['moi']):
                day[stock] = {'buy10': v['buy10_pct'], 'sell10': v['sell10_pct'],
                              'moi': v['market_oi'], 'std': is_standard}
        cache[d] = day

        if (i + 1) % 25 == 0:
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(cache, f)
            print(f'    {i + 1}/{len(todo)}', flush=True)
        time.sleep(sleep)

    with open(cache_path, 'w', encoding='utf-8') as f:
        json.dump(cache, f)
    return cache


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--years', default='2025')
    ap.add_argument('--months', default='2026-01:2026-09')
    ap.add_argument('--since', default='2025-08-01', help='大額交易人只抓這天之後')
    ap.add_argument('--skip-large-trader', action='store_true')
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    years = [int(y) for y in args.years.split(',') if y]
    a, b = args.months.split(':')
    months = []
    y, m = int(a[:4]), int(a[5:7])
    ey, em = int(b[:4]), int(b[5:7])
    while (y, m) <= (ey, em):
        months.append(f'{y:04d}-{m:02d}')
        m += 1
        if m > 12:
            y, m = y + 1, 1

    print('建立契約對應表 …', flush=True)
    cmap = build_contract_map()
    minis = sum(1 for v in cmap.values() if v[1] == LOT_MINI)
    print(f'  {len(cmap)} 個契約 → {len({v[0] for v in cmap.values()})} 檔股票'
          f'（小型契約 {minis} 個）', flush=True)

    print('抓行情 …', flush=True)
    market = fetch_market(args.out_dir, years, months, cmap)
    dates = sorted(d for d in market if d >= args.since)
    print(f'  行情涵蓋 {len(market)} 個交易日，{dates[0]} ~ {dates[-1]}', flush=True)

    lt = {}
    if not args.skip_large_trader:
        print('抓大額交易人 …', flush=True)
        lt = fetch_large_trader(args.out_dir, dates, cmap)

    # 併成 {stock: {date: {...}}}
    merged = {}
    for d in dates:
        for stock, v in market[d].items():
            row = {'oi': v['oi'], 'vol': v['vol']}
            ltv = lt.get(d, {}).get(stock)
            if ltv:
                row['buy10'] = ltv['buy10']
                row['sell10'] = ltv['sell10']
            merged.setdefault(stock, {})[d] = row

    out = os.path.join(args.out_dir, 'ssf-daily.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'dates': dates, 'stocks': merged}, f)
    print(f'✅ 完成：{len(merged)} 檔股票 × {len(dates)} 個交易日 → {out}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())

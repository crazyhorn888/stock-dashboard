#!/usr/bin/env python3
"""
從期交所官方序列（FinMind v4）重建 heat-history.json。

為什麼不用 Phase2 Google Sheet（AC-HT-B8）：
  Sheet 的 OP Detail「BC/SC/BP/SP」四組欄位在 2025-05-08 換過定義——
  之前存的是「未平倉」、之後才是「交易」。兩者是完全不同的量，整段當同一
  種東西回補，會讓 dSC 與 fCP（六項裡的兩項）建在錯的基礎上；Z 值用 250 日
  滾動窗，污染還會往後延將近一年。已逐日對期交所 callsAndPutsDateDown 核對。

FinMind 的 TaiwanOptionInstitutionalInvestors 與期交所逐日完全一致
（long_deal_* = 交易、*_open_interest_balance_* = 未平倉），而且回溯到
2018-06-05，比 Sheet 的 2022-01-03 多出約 900 個交易日。

欄位定義與 scripts/calc-heat.mjs 的 extractFeatures 一一對應：
  bias60   收盤 / MA60 − 1
  dCallOI  自營買權「未平倉淨額」金額 ÷ 選擇權金額規模
  dSC      自營買權「賣出交易」金額 ÷ 選擇權金額規模
  fCP      外資買權買方交易口數 ÷ 外資賣權買方交易口數
  tFut5    投信台指期淨 OI 的 5 日變動 ÷ (投信多 + 投信空)
  vol5     成交金額 5 日變動%
  fSpot    外資現貨買賣超 ÷ 當日成交金額
  規模     外資 + 自營，買權賣權，買方賣方，八筆交易金額的絕對值總和

用法：python3 scripts/rebuild-heat-history.py --out data/heat-history.json
"""
import argparse, json, ssl, sys, time, urllib.parse, urllib.request
from collections import defaultdict

API = 'https://api.finmindtrade.com/api/v4/data'
CTX = ssl.create_default_context()
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    pass
INST = ('外資', '投信', '自營商')


def fetch(dataset, data_id, start, end, tries=5):
    q = {'dataset': dataset, 'start_date': start, 'end_date': end}
    if data_id:
        q['data_id'] = data_id
    url = f'{API}?{urllib.parse.urlencode(q)}'
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=180, context=CTX) as r:
                j = json.load(r)
            if j.get('status') != 200:
                raise ValueError(str(j.get('msg'))[:120])
            return j.get('data', [])
        except Exception as e:
            print(f'    重試 {k + 1}/{tries}：{e}', file=sys.stderr)
            time.sleep(8 * (k + 1))
    raise SystemExit(f'錯誤：{dataset} {start}~{end} 連續 {tries} 次失敗')


def pull(y0, y1):
    jobs = (('price', 'TaiwanStockPrice', 'TAIEX'),
            ('opt', 'TaiwanOptionInstitutionalInvestors', 'TXO'),
            ('fut', 'TaiwanFuturesInstitutionalInvestors', 'TX'),
            ('spot', 'TaiwanStockTotalInstitutionalInvestors', None))
    out = {}
    for tag, ds, did in jobs:
        rows = []
        for y in range(y0, y1 + 1):
            rows += fetch(ds, did, f'{y}-01-01', f'{y}-12-31')
            time.sleep(3)
        print(f'  {tag}: {len(rows)} 筆', file=sys.stderr)
        out[tag] = rows
    return out


def build(raw):
    px = {r['date']: r for r in raw['price']}
    dates = sorted(px)
    opt = defaultdict(dict)
    for r in raw['opt']:
        opt[r['date']][(r['call_put'], r['institutional_investors'])] = r
    fut = defaultdict(dict)
    for r in raw['fut']:
        lo = r.get('long_open_interest_balance_volume')
        sh = r.get('short_open_interest_balance_volume')
        if lo is not None and sh is not None:
            fut[r['date']][r['institutional_investors']] = (lo, sh, lo - sh)
    spot = defaultdict(dict)
    for r in raw['spot']:
        spot[r['date']][r['name']] = r['buy'] - r['sell']

    def ov(d, cp, who, f):
        r = opt.get(d, {}).get((cp, who))
        return r.get(f) if r else None

    def rnd(v):
        return round(v, 4) if isinstance(v, (int, float)) else None

    data = {}
    for i, d in enumerate(dates):
        close = px[d]['close']
        money = px[d]['Trading_money']

        bias60 = None
        if i >= 59:
            seg = [px[dates[j]]['close'] for j in range(i - 59, i + 1)]
            ma = sum(seg) / 60
            if ma:
                bias60 = (close / ma - 1) * 100

        amts = [ov(d, cp, w, f) for w in ('外資', '自營商') for cp in ('買權', '賣權')
                for f in ('long_deal_amount', 'short_deal_amount')]
        scale = (sum(abs(x) for x in amts)
                 if all(isinstance(x, (int, float)) for x in amts) and any(amts) else None)

        lo = ov(d, '買權', '自營商', 'long_open_interest_balance_amount')
        sh = ov(d, '買權', '自營商', 'short_open_interest_balance_amount')
        net = lo - sh if (lo is not None and sh is not None) else None
        dCallOI = net / scale * 100 if (scale and net is not None) else None

        dsc = ov(d, '買權', '自營商', 'short_deal_amount')
        dSC = dsc / scale * 100 if (scale and dsc is not None) else None

        fbc, fbp = ov(d, '買權', '外資', 'long_deal_volume'), ov(d, '賣權', '外資', 'long_deal_volume')
        fCP = fbc / fbp if (fbc is not None and fbp) else None

        tFut5 = None
        if i >= 5:
            c, p = fut.get(d, {}).get('投信'), fut.get(dates[i - 5], {}).get('投信')
            if c and p and (c[0] + c[1]):
                tFut5 = (c[2] - p[2]) / (c[0] + c[1]) * 100

        vol5 = None
        if i >= 5:
            b = px[dates[i - 5]]['Trading_money']
            if money > 0 and b > 0:
                vol5 = (money / b - 1) * 100

        fs = spot.get(d, {}).get('Foreign_Investor')
        fSpot = fs / money * 100 if (fs is not None and money > 0) else None

        data[d] = {'bias60': rnd(bias60), 'dCallOI': rnd(dCallOI), 'dSC': rnd(dSC),
                   'fCP': rnd(fCP), 'tFut5': rnd(tFut5), 'vol5': rnd(vol5),
                   'fSpot': rnd(fSpot)}
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='data/heat-history.json')
    ap.add_argument('--from-year', type=int, default=2018)
    ap.add_argument('--to-year', type=int, default=2026)
    ap.add_argument('--cache', help='已下載的原始 JSON，給重跑用')
    a = ap.parse_args()

    if a.cache:
        raw = json.load(open(a.cache))
    else:
        print(f'從 FinMind 抓 {a.from_year}~{a.to_year}…', file=sys.stderr)
        raw = pull(a.from_year, a.to_year)
        if a.out:
            json.dump(raw, open(a.out + '.raw', 'w'))

    data = build(raw)
    KEYS = ('bias60', 'dCallOI', 'dSC', 'fCP', 'tFut5', 'vol5')
    full = {d: v for d, v in data.items() if all(v[k] is not None for k in KEYS)}
    json.dump(data, open(a.out, 'w'), ensure_ascii=False, separators=(',', ':'))
    ds = sorted(data)
    print(f'共 {len(data)} 天　{ds[0]} ~ {ds[-1]}', file=sys.stderr)
    print(f'六項齊全 {len(full)} 天（{min(full)} ~ {max(full)}）', file=sys.stderr)
    for k in KEYS + ('fSpot',):
        n = sum(1 for v in data.values() if v[k] is not None)
        print(f'  {k:<8}{n:>5} 天', file=sys.stderr)


if __name__ == '__main__':
    main()

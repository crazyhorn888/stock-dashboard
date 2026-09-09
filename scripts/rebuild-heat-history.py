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

順便產出「對做分析」用的 6 個特徵（--pairs-out）。它們不進 heat-history、
也不影響 production，只給回測用——但欄位對應（散戶用零和反推、規模分母怎麼取）
是對著期交所核出來的，寫在這裡才不會每次重來。見 docs/backlog.md 的 A 節。

用法：
  python3 scripts/rebuild-heat-history.py --out data/heat-history.json
  python3 scripts/rebuild-heat-history.py --out /tmp/h.json --pairs-out /tmp/pairs.json
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
            ('spot', 'TaiwanStockTotalInstitutionalInvestors', None),
            # 只有 --pairs-out 的 fFutD5 需要（分母＝全市場 OI），一起抓比較單純
            ('futday', 'TaiwanFuturesDaily', 'TX'))
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


def build_pairs(raw):
    """
    對做分析用的 6 個特徵（全部相對化，與熱度同一套 Z 視窗）。

    rCallNet / rPutNet  散戶選擇權淨買買權 / 賣權，佔選擇權口數規模%
                        散戶＝零和反推（−三大法人淨額），與 Phase1 的算法一致
    fCallNet            外資選擇權淨買買權，佔口數規模%
    fSC                 外資賣出買權金額，佔選擇權金額規模%
    fFutD5              外資台指期淨 OI 的 5 日變動，佔全市場 OI%
    fSpot5              外資現貨 5 日累積買賣超，佔 5 日成交金額%
    """
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
            fut[r['date']][r['institutional_investors']] = lo - sh
    spot = defaultdict(dict)
    for r in raw['spot']:
        spot[r['date']][r['name']] = r['buy'] - r['sell']
    total_oi = defaultdict(int)
    for r in raw.get('futday', []):
        if r.get('trading_session') == 'position' and r.get('open_interest'):
            total_oi[r['date']] += r['open_interest']

    def ov(d, cp, who, f):
        r = opt.get(d, {}).get((cp, who))
        return r.get(f) if r else None

    def scale(d, field_pair):
        a = [ov(d, cp, w, f) for w in ('外資', '自營商') for cp in ('買權', '賣權')
             for f in field_pair]
        return (sum(abs(x) for x in a)
                if all(isinstance(x, (int, float)) for x in a) and any(a) else None)

    def rnd(v):
        return round(v, 4) if isinstance(v, (int, float)) else None

    out = {}
    for i, d in enumerate(dates):
        o = {}
        lots = scale(d, ('long_deal_volume', 'short_deal_volume'))
        amts = scale(d, ('long_deal_amount', 'short_deal_amount'))

        # 選擇權淨買（口數）；散戶用零和反推
        net = {}
        for cp in ('買權', '賣權'):
            tot, ok = 0, True
            for w in INST:
                a, b = ov(d, cp, w, 'long_deal_volume'), ov(d, cp, w, 'short_deal_volume')
                if a is None or b is None:
                    ok = False
                    break
                net[(cp, w)] = a - b
                tot += a - b
            net[(cp, '散戶')] = -tot if ok else None
        for key, cp in (('rCallNet', '買權'), ('rPutNet', '賣權')):
            v = net.get((cp, '散戶'))
            o[key] = v / lots * 100 if (lots and v is not None) else None
        fc = net.get(('買權', '外資'))
        o['fCallNet'] = fc / lots * 100 if (lots and fc is not None) else None

        fsc = ov(d, '買權', '外資', 'short_deal_amount')
        o['fSC'] = fsc / amts * 100 if (amts and fsc is not None) else None

        # 外資期貨淨 OI 的 5 日變動，分母＝全市場未平倉（TaiwanFuturesDaily 的
        # trading_session='position' 各契約 open_interest 加總）。
        # 不要改用「三大法人淨額絕對值加總」之類的代理——實測 r 只有 0.75，
        # 會讓 docs/backlog.md 裡的訊號③ 重現不出來
        o['fFutD5'] = None
        if i >= 5:
            c, p5 = fut.get(d, {}).get('外資'), fut.get(dates[i - 5], {}).get('外資')
            toi = total_oi.get(d)
            if c is not None and p5 is not None and toi:
                o['fFutD5'] = (c - p5) / toi * 100

        # 外資現貨 5 日累積佔量
        o['fSpot5'] = None
        if i >= 4:
            fs = [spot.get(dates[j], {}).get('Foreign_Investor') for j in range(i - 4, i + 1)]
            tm = [px.get(dates[j], {}).get('Trading_money') for j in range(i - 4, i + 1)]
            if all(x is not None for x in fs) and all(tm) and sum(tm):
                o['fSpot5'] = sum(fs) / sum(tm) * 100

        out[d] = {k: rnd(v) for k, v in o.items()}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='data/heat-history.json')
    ap.add_argument('--pairs-out', help='另外輸出對做分析用的 6 個特徵（回測用，不進 production）')
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

    if a.pairs_out:
        pairs = build_pairs(raw)
        json.dump(pairs, open(a.pairs_out, 'w'), ensure_ascii=False, separators=(',', ':'))
        print(f'\n對做特徵 → {a.pairs_out}', file=sys.stderr)
        for k in ('rCallNet', 'rPutNet', 'fCallNet', 'fSC', 'fFutD5', 'fSpot5'):
            n = sum(1 for v in pairs.values() if v[k] is not None)
            print(f'  {k:<10}{n:>5} 天', file=sys.stderr)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
一次性回補「市場熱度」所需的歷史特徵（AC-HT-B1~B3）。

從 stock-chips-daily 的 Phase2 Google Sheet（Master + OP Detail）讀 2022-01-03 起的
全部交易日，算出 6 項熱度特徵的原始值，輸出 heat-history.json 供 pipeline 端使用。

**不修改 Google Sheet 任何欄位，純讀取。**

用法：
    CHIPS_SPREADSHEET_ID=<sheet_id> python3 backfill-heat-history.py [--out heat-history.json]

輸出格式（AC-HT-B2，只存原始值不存完整籌碼）：
    {"2022-01-03": {"bias60": 1.23, "dCallOI": 6.07, "dSC": 16.5,
                    "fCP": 1.835, "tFut5": null, "vol5": -0.21}, ...}

後續每日由 pipeline 從 chips/{date}.json 追加一筆（AC-HT-B4）。
"""
import json, argparse, sys, os, urllib.request, urllib.parse, time, ssl
from datetime import date, timedelta

# ⚠️ 本 repo 為 PUBLIC——機密一律走環境變數，不得硬編碼（比照 scripts/write-firebase.mjs）
#   CHIPS_SPREADSHEET_ID   Phase2 籌碼表的 Google Sheet ID
#   GOOGLE_SHEETS_TOKEN    OAuth token json 路徑（預設 ~/.config/google-sheets-mcp/tokens.json）
#   GOOGLE_OAUTH_CRED      OAuth client json 路徑（預設 ~/.config/google-mcp/credentials.json）
SPREADSHEET_ID = os.environ.get('CHIPS_SPREADSHEET_ID', '')
TOKEN_FILE = os.environ.get(
    'GOOGLE_SHEETS_TOKEN', os.path.expanduser('~/.config/google-sheets-mcp/tokens.json'))
CRED_FILE = os.environ.get(
    'GOOGLE_OAUTH_CRED', os.path.expanduser('~/.config/google-mcp/credentials.json'))
EPOCH = date(1899, 12, 30)

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CTX = None

# ── Google Sheets 讀取（純 stdlib，避免相依 venv）─────────────────────────
def _access_token():
    tok = json.load(open(TOKEN_FILE))
    if time.time() < tok.get('expiry_date', 0) / 1000 - 60:
        return tok['access_token']
    cred = json.load(open(CRED_FILE))
    cred = cred.get('installed') or cred.get('web')
    data = urllib.parse.urlencode({
        'client_id': cred['client_id'], 'client_secret': cred['client_secret'],
        'refresh_token': tok['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    r = json.load(urllib.request.urlopen(
        urllib.request.Request('https://oauth2.googleapis.com/token', data=data),
        timeout=30, context=CTX))
    tok['access_token'] = r['access_token']
    tok['expiry_date'] = int((time.time() + r.get('expires_in', 3600)) * 1000)
    json.dump(tok, open(TOKEN_FILE, 'w'))
    return tok['access_token']

def read_range(rng):
    url = (f'https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/'
           f'{urllib.parse.quote(rng)}?valueRenderOption=UNFORMATTED_VALUE')
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {_access_token()}'})
    return json.load(urllib.request.urlopen(req, timeout=90, context=CTX)).get('values', [])

def num(v):
    s = str(v).strip().replace(',', '')
    if s in ('', 'None', '#N/A', '#DIV/0!', '#VALUE!', '#REF!'):
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    return None if x != x or abs(x) == float('inf') else x

# ── 欄位索引（0-based，對應試算表 A=0）─────────────────────────────────
M = {'date': 0, 'close': 3, 'pct': 6, 'vol': 7,
     'fx_call_oi_amt': 18, 'fx_put_oi_amt': 21, 'fx_bcbp': 23,
     'dl_call_oi_amt': 29, 'dl_put_oi_amt': 32}
O = {'date': 0, 'fx_bc_amt': 7, 'fx_sc_amt': 9, 'fx_bp_amt': 13, 'fx_sp_amt': 15,
     'dl_bc_amt': 19, 'dl_sc_amt': 21, 'dl_bp_amt': 25, 'dl_sp_amt': 27}

def load_sheets():
    master = read_range('Master!A6:AR2000')
    opdet  = read_range("'OP Detail'!A6:AD2000")
    md, od = {}, {}
    for r in master:
        r = list(r) + [''] * 44
        d = num(r[M['date']])
        if d is None:
            continue
        md[EPOCH + timedelta(days=int(d))] = r
    for r in opdet:
        r = list(r) + [''] * 30
        d = num(r[O['date']])
        if d is None:
            continue
        od[EPOCH + timedelta(days=int(d))] = r
    return md, od

def repair_close(dates, md):
    """AC-HT-B3：修 close 壞值（|pct|<11 但推得日變動 >11% → 以 前日×(1+pct%) 取代）"""
    fixed = []
    for i in range(1, len(dates)):
        prev, cur = num(md[dates[i-1]][M['close']]), num(md[dates[i]][M['close']])
        pct = num(md[dates[i]][M['pct']])
        if not prev or cur is None or pct is None:
            continue
        if abs(pct) < 11 and abs((cur - prev) / prev * 100) > 11:
            good = prev * (1 + pct / 100)
            md[dates[i]][M['close']] = good
            fixed.append((dates[i], cur, good))
    return fixed

def build(md, od):
    dates = sorted(md)
    fixed = repair_close(dates, md)
    for d, bad, good in fixed:
        print(f'  [修正] {d} close {bad:.2f} → {good:.2f}', file=sys.stderr)

    close = [num(md[d][M['close']]) for d in dates]
    vol   = [num(md[d][M['vol']])   for d in dates]

    def ma(x, w, i):
        seg = x[max(0, i - w + 1):i + 1]
        return sum(seg) / len(seg) if len(seg) == w and all(v is not None for v in seg) else None

    out = {}
    for i, d in enumerate(dates):
        mr, orow = md[d], od.get(d)
        # f1 大盤乖離 MA60%
        m60 = ma(close, 60, i)
        bias60 = (close[i] / m60 - 1) * 100 if (m60 and close[i]) else None
        # 選擇權金額規模：外資+自營 8 類金額絕對值總和（來自 OP Detail）
        scale = None
        if orow:
            vals = [num(orow[O[k]]) for k in
                    ('fx_bc_amt', 'fx_sc_amt', 'fx_bp_amt', 'fx_sp_amt',
                     'dl_bc_amt', 'dl_sc_amt', 'dl_bp_amt', 'dl_sp_amt')]
            if all(v is not None for v in vals):
                s = sum(abs(v) for v in vals)
                scale = s if s > 0 else None
        # f2 自營 CallOI 金額佔比%（Master AD 欄）
        dcall = num(mr[M['dl_call_oi_amt']])
        dCallOI = dcall / scale * 100 if (dcall is not None and scale) else None
        # f3 自營 SC 金額佔比%
        dsc = num(orow[O['dl_sc_amt']]) if orow else None
        dSC = dsc / scale * 100 if (dsc is not None and scale) else None
        # f4 外資買方 C/P 比（Master X 欄，已是口數比）
        fCP = num(mr[M['fx_bcbp']])
        # f6 成交量 5 日變動%
        vol5 = ((vol[i] / vol[i-5] - 1) * 100
                if (i >= 5 and vol[i] is not None and vol[i-5]) else None)
        out[str(d)] = {'bias60': _r(bias60), 'dCallOI': _r(dCallOI), 'dSC': _r(dSC),
                       'fCP': _r(fCP), 'tFut5': None, 'vol5': _r(vol5)}
    return out, dates

def _r(v, n=4):
    return round(v, n) if isinstance(v, (int, float)) else None

FINMIND = ('https://api.finmindtrade.com/api/v4/data'
           '?dataset=TaiwanFuturesInstitutionalInvestors&data_id=TX'
           '&start_date={a}&end_date={b}')

def fetch_trust_fut(y0, y1):
    """投信台指期未平倉（AC-HT-C2 的 f5）。TAIFEX 會限流，改用 FinMind 按年抓。"""
    import urllib.request as U
    out = {}
    for y in range(y0, y1 + 1):
        for attempt in range(3):
            try:
                raw = U.urlopen(FINMIND.format(a=f'{y}-01-01', b=f'{y}-12-31'),
                                timeout=90, context=CTX).read()
                j = json.loads(raw)
                if j.get('status') != 200:
                    raise ValueError(str(j.get('msg'))[:60])
                for r in j.get('data', []):
                    if r.get('institutional_investors') != '投信':
                        continue
                    lo = r.get('long_open_interest_balance_volume')
                    sh = r.get('short_open_interest_balance_volume')
                    if lo is None or sh is None:
                        continue
                    out[r['date']] = [lo, sh, lo - sh]
                break
            except Exception as e:
                if attempt == 2:
                    print(f'  [警告] 投信期貨 {y} 抓取失敗：{e}', file=sys.stderr)
                else:
                    time.sleep(6 * (attempt + 1))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='heat-history.json')
    ap.add_argument('--skip-trust-fut', action='store_true',
                    help='跳過投信期貨（f5 留 null）')
    a = ap.parse_args()
    if not SPREADSHEET_ID:
        sys.exit('錯誤：未設定 CHIPS_SPREADSHEET_ID 環境變數\n'
                 '  用法：CHIPS_SPREADSHEET_ID=<sheet_id> python3 scripts/backfill-heat-history.py')
    for f, label in ((TOKEN_FILE, 'GOOGLE_SHEETS_TOKEN'), (CRED_FILE, 'GOOGLE_OAUTH_CRED')):
        if not os.path.exists(f):
            sys.exit(f'錯誤：找不到 {label} 指向的檔案：{f}')
    print('讀取 Phase2 Google Sheet（純讀取，不修改任何欄位）…', file=sys.stderr)
    md, od = load_sheets()
    print(f'  Master {len(md)} 列、OP Detail {len(od)} 列', file=sys.stderr)
    data, dates = build(md, od)

    # f5 投信期貨 5 日變動佔規模%（AC-HT-C2）
    if not a.skip_trust_fut:
        print('抓投信台指期未平倉（FinMind）…', file=sys.stderr)
        tf = fetch_trust_fut(dates[0].year, dates[-1].year)
        ds = sorted(data)
        for i, d in enumerate(ds):
            cur, prev = tf.get(d), tf.get(ds[i - 5]) if i >= 5 else None
            if cur and prev:
                scale = cur[0] + cur[1]
                if scale:
                    data[d]['tFut5'] = _r((cur[2] - prev[2]) / scale * 100)
        got = sum(1 for v in data.values() if v['tFut5'] is not None)
        print(f'  投信期貨覆蓋 {got}/{len(data)} 天', file=sys.stderr)

    json.dump(data, open(a.out, 'w'), ensure_ascii=False, separators=(',', ':'))
    size = os.path.getsize(a.out)
    cov = {k: sum(1 for v in data.values() if v[k] is not None) for k in
           ('bias60', 'dCallOI', 'dSC', 'fCP', 'tFut5', 'vol5')}
    print(f'\n✅ {a.out}：{len(data)} 天（{dates[0]} ~ {dates[-1]}），'
          f'{size:,} bytes = {size/1024:.0f} KB', file=sys.stderr)
    print('   欄位覆蓋率：' + '  '.join(
        f'{k} {100*v/len(data):.0f}%' for k, v in cov.items()), file=sys.stderr)
    if size > 300 * 1024:
        print(f'   ⚠️ 超過 AC-HT-B2 的 300 KB 上限', file=sys.stderr)

if __name__ == '__main__':
    main()

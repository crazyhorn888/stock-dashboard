#!/usr/bin/env python3
"""
backtest-holders-fetch.py — AC-BT-2：一次性爬 TDCC 股權分散表歷史。

TDCC 只保留一年（51 週），而且歷史只能「單檔 × 單週」查（全市場批次只有當週），
所以回測樣本限縮在 320 檔有個股期貨的標的（AC-BT-1）。

輸出 JSONL（每行一筆），可中斷續跑：已經在輸出檔裡的 (date, code) 直接跳過。

    python3 scripts/backtest-holders-fetch.py --out /tmp/holders-history.jsonl

零第三方依賴（urllib + http.cookiejar），/usr/bin/python3 3.9 與 3.14 都能跑。

⚠️ 兩個踩坑：
 1. 網頁版的級距表只有 16 列（16 = 合計），CSV 版是 17 列（16 = 差異數調整、17 = 合計）。
    一律用「級距文字」判斷，不能用列索引——用索引會把合計當成 1,000,001 以上。
 2. SYNCHRONIZER_TOKEN 每次回應都會換一顆，要從上一次的回應接著拿；
    token 過期時 TDCC 回 302（不是 4xx），必須把 302 當失敗重抓首頁。
"""

import argparse
import gzip
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = 'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock'
SSF_LIST = 'https://openapi.taifex.com.tw/v1/SSFLists'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

# 百張 = 100 張 = 100,000 股，級距下界 100,001 起；千張 = 1,000,001 起
HUNDRED_LOT_MIN = 100_001
THOUSAND_LOT_MIN = 1_000_001


def build_opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def http_get(opener, url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'})
    with opener.open(req, timeout=timeout) as res:
        raw = res.read()
        if res.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
        return raw.decode('utf-8', errors='ignore')


def http_post(opener, url, data, timeout=40):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': url,
        'Accept-Encoding': 'gzip',
    })
    with opener.open(req, timeout=timeout) as res:
        raw = res.read()
        if res.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
        return res.geturl(), raw.decode('utf-8', errors='ignore')


def extract_token(html):
    m = re.search(r'name="SYNCHRONIZER_TOKEN"\s+value="([^"]*)"', html)
    return m.group(1) if m else None


def extract_dates(html):
    """查詢頁下拉選單裡的所有資料週別（新到舊）。"""
    return re.findall(r'<option value="(\d{8})"', html)


def parse_levels(html):
    """回傳 (h, k, total_shares)。解析不到完整的級距表 → None。"""
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S)
    h = k = 0.0
    total = None
    seen = 0
    for r in rows:
        cells = [re.sub(r'\s+', '', re.sub(r'<[^>]+>', '', c))
                 for c in re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)]
        if len(cells) != 5 or not re.fullmatch(r'\d{1,2}', cells[0]):
            continue
        label, shares, pct = cells[1], cells[3], cells[4]
        try:
            shares_n = int(shares.replace(',', ''))
            pct_n = float(pct)
        except ValueError:
            continue
        seen += 1
        if '合計' in label:
            total = shares_n
            continue
        # 級距文字長這樣：1-999 / 100,001-200,000 / 1,000,001以上
        m = re.match(r'([\d,]+)', label)
        if not m:
            continue
        low = int(m.group(1).replace(',', ''))
        if low >= HUNDRED_LOT_MIN:
            h += pct_n
        if low >= THOUSAND_LOT_MIN:
            k += pct_n
    # 完整的一張表是 15 個級距 + 合計；少於這個數就是被截斷或查無資料
    if seen < 16 or total is None:
        return None
    return round(h, 2), round(k, 2), total


def load_done(path):
    done = set()
    if not os.path.exists(path):
        return done
    with open(path, encoding='utf-8') as f:
        for line in f:
            try:
                r = json.loads(line)
                done.add((r['date'], r['code']))
            except Exception:
                continue
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--sleep', type=float, default=0.7)
    ap.add_argument('--limit-stocks', type=int, default=0, help='只跑前 N 檔（測試用）')
    ap.add_argument('--codes-file', help='一行一個代號的清單檔；不給就用 SSFLists 的 320 個契約標的')
    ap.add_argument('--shard', help='分片，格式 i/n（例：1/3）。多開幾支平行跑時用，各自寫各自的 out')
    ap.add_argument('--limit-weeks', type=int, default=0, help='只跑最近 N 週（測試用）')
    args = ap.parse_args()

    opener = build_opener()

    if args.codes_file:
        with open(args.codes_file, encoding='utf-8') as f:
            codes = [line.strip() for line in f if line.strip()]
    else:
        codes = [r['StockCode'].strip() for r in json.loads(http_get(opener, SSF_LIST))]
    codes = sorted(set(codes))
    if args.limit_stocks:
        codes = codes[:args.limit_stocks]
    if args.shard:
        i, n = (int(x) for x in args.shard.split('/'))
        # 用 index % n 切，讓每片的代號分散在整個清單裡（連號的股票常常同族群、
        # 回應時間也相近，照區段切會讓某一片特別慢）
        codes = [c for k, c in enumerate(codes) if k % n == (i - 1)]
        print(f'分片 {i}/{n}：分到 {len(codes)} 檔', flush=True)

    home = http_get(opener, BASE)
    token = extract_token(home)
    dates = extract_dates(home)
    if args.limit_weeks:
        dates = dates[:args.limit_weeks]
    if not token or not dates:
        print('❌ 首頁沒拿到 token 或週別清單', file=sys.stderr)
        return 1

    done = load_done(args.out)
    todo = [(d, c) for c in codes for d in dates if (d, c) not in done]
    print(f'標的 {len(codes)} 檔 × 週別 {len(dates)} 週 = {len(codes) * len(dates)} 組'
          f'；已完成 {len(done)}，待抓 {len(todo)}', flush=True)

    ok = fail = 0
    t0 = time.time()
    with open(args.out, 'a', encoding='utf-8') as out:
        for i, (date, code) in enumerate(todo):
            parsed = None
            for attempt in range(3):
                try:
                    url, html = http_post(opener, BASE, {
                        'SYNCHRONIZER_TOKEN': token,
                        'SYNCHRONIZER_URI': '/portal/zh/smWeb/qryStock',
                        'method': 'submit',
                        'firDate': '',
                        'scaDate': date,
                        'sqlMethod': 'StockNo',
                        'stockNo': code,
                        'stockName': '',
                    })
                    fresh = extract_token(html)
                    if fresh:
                        token = fresh
                    parsed = parse_levels(html)
                    if parsed:
                        break
                    # 沒解析到：token 過期（302 回首頁）或該週該股沒資料
                    home = http_get(opener, BASE)
                    token = extract_token(home) or token
                except Exception as e:
                    time.sleep(2 * (attempt + 1))
                    try:
                        home = http_get(opener, BASE)
                        token = extract_token(home) or token
                    except Exception:
                        pass
                    if attempt == 2:
                        print(f'  ⚠️ {date} {code} 失敗：{e}', file=sys.stderr, flush=True)

            if parsed:
                h, k, total = parsed
                out.write(json.dumps({'date': date, 'code': code, 'h': h, 'k': k, 'total': total},
                                     ensure_ascii=False) + '\n')
                ok += 1
            else:
                # 查無資料也記一筆 null，下次續跑才不會重抓（新上市／已下市的週別）
                out.write(json.dumps({'date': date, 'code': code, 'h': None, 'k': None, 'total': None}) + '\n')
                fail += 1

            if (i + 1) % 200 == 0:
                out.flush()
                el = time.time() - t0
                rate = (i + 1) / el
                eta = (len(todo) - i - 1) / rate / 60
                print(f'  {i + 1}/{len(todo)}  成功 {ok} 無資料 {fail}  '
                      f'{rate:.2f} 筆/秒  剩餘約 {eta:.0f} 分', flush=True)

            time.sleep(args.sleep)

    print(f'✅ 完成：成功 {ok}、無資料 {fail}，輸出 {args.out}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())

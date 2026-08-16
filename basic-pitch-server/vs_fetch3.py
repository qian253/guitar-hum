# -*- coding: utf-8 -*-
"""vs_fetch3.py — 用 seek 型 HTTP 包装器 + 标准 zipfile 精准提取 VocalSet 音阶/琶音 wav
(不再手撕 zip 结构;zipfile 只按需拉 EOCD/中央目录/目标文件,每次 64KB 小块+断线重试)"""
import io
import os
import sys
import time
import urllib.request
import zipfile

sys.stdout.reconfigure(encoding="utf-8")

URL = "https://zenodo.org/api/records/1442513/files/VocalSet1-2.zip/content"
OUT = "eval_data/vocalset"
CAP = 80
TOTAL = 5991573193

os.makedirs(OUT, exist_ok=True)


class HttpRangeFile(io.RawIOBase):
    """按需 Range 读取的只读文件对象(块缓存 64KB,断线重试)"""

    def __init__(self, url, total):
        self.url = url
        self.total = total
        self.pos = 0
        self.block = b""   # 当前块
        self.block_off = -1

    def _fetch(self, off, n):
        for attempt in range(12):
            try:
                req = urllib.request.Request(self.url, headers={"Range": "bytes=%d-%d" % (off, off + n - 1)})
                resp = urllib.request.urlopen(req, timeout=90)
                data = resp.read()
                resp.close()
                if len(data) == n:
                    return data
            except Exception:  # noqa: BLE001
                time.sleep(1.5)
        return None

    def readable(self):
        return True

    def seekable(self):
        return True

    def readinto(self, b):
        want = len(b)
        got = 0
        while got < want and self.pos < self.total:
            if self.block_off <= self.pos < self.block_off + len(self.block):
                i = self.pos - self.block_off
                take = min(want - got, len(self.block) - i)
                b[got:got + take] = self.block[i:i + take]
                self.pos += take
                got += take
            else:
                n = min(65536, self.total - self.pos)
                data = self._fetch(self.pos, n)
                if data is None:
                    break
                self.block = data
                self.block_off = self.pos
        return got

    def seek(self, offset, whence=0):
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        elif whence == 2:
            self.pos = self.total + offset
        return self.pos

    def tell(self):
        return self.pos


print("以 zipfile 方式打开远端 zip…", flush=True)
rf = HttpRangeFile(URL, TOTAL)
zf = zipfile.ZipFile(rf)
all_names = [n for n in zf.namelist() if n.endswith(".wav") and not n.startswith("__MACOSX")]
# 命名: f1_scales_c_fast_piano_u.wav → 只挑干净的旋律类(scales/arpeggios),风格 straight/piano(不要 lip_trill/vocal_fry/breathy/belt)
names = [n for n in all_names if ("_scales_" in n or "_arpeggios_" in n) and ("straight" in n or "piano" in n)]
print("音阶/琶音 wav 共", len(names), "个,取前", CAP, flush=True)

count = 0
saved = []
for n in names[:CAP]:
    try:
        data = zf.open(n).read()
    except Exception as e:  # noqa: BLE001
        print("  !! 读取失败", n, e, flush=True)
        continue
    safe = os.path.basename(n)
    with open(os.path.join(OUT, safe), "wb") as f:
        f.write(data)
    saved.append(safe)
    count += 1
    print("  提取 %d %s (%dKB)" % (count, safe, len(data) // 1024), flush=True)

with open(os.path.join(OUT, "_names.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(saved))
print("完成:提取 %d 个文件 → %s" % (count, os.path.abspath(OUT)))

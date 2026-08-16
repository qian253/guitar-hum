# -*- coding: utf-8 -*-
"""vs_fetch2.py — VocalSet 精准提取:先拉 zip 末尾中央目录(几百KB)拿到音阶/琶音
wav 的精确字节偏移与真实尺寸,再逐文件 Range 下载(断点重试),完全不扫全包。"""
import os
import struct
import sys
import time
import urllib.request
import zlib

sys.stdout.reconfigure(encoding="utf-8")

URL = "https://zenodo.org/api/records/1442513/files/VocalSet1-2.zip/content"
OUT = "eval_data/vocalset"
CAP = 80
TOTAL = 5991573193  # content-length

os.makedirs(OUT, exist_ok=True)


def fetch_range(offset, length, retries=12, chunk=65536):
    """分块拉取指定字节区间(断点续传,块大小默认 300KB,大区间不易被掐)"""
    out = bytearray()
    pos = offset
    end = offset + length
    while pos < end:
        n = min(chunk, end - pos)
        got = None
        for attempt in range(retries):
            try:
                req = urllib.request.Request(URL, headers={"Range": "bytes=%d-%d" % (pos, pos + n - 1)})
                resp = urllib.request.urlopen(req, timeout=90)
                got = resp.read()
                resp.close()
                if len(got) == n:
                    break
                got = None
            except Exception as e:  # noqa: BLE001
                print("  块中断 @%d 重试…" % pos, flush=True)
                time.sleep(2)
        if got is None:
            print("  块 @%d 连续 %d 次失败,放弃" % (pos, retries), flush=True)
            return None
        out += got
        pos += n
    return bytes(out)


print("拉取 zip 末尾中央目录…")
tail = fetch_range(TOTAL - 400000, 400000)
assert tail, "中央目录拉取失败"
eocd = tail.rfind(b"PK\x05\x06")
assert eocd >= 0, "EOCD 未找到"
_disk, _cddisk, cd_entries, _cd_total, cd_size, cd_offset, _clen = struct.unpack("<HHHHIIH", tail[eocd + 4:eocd + 22])
print("中央目录条目数:", cd_entries, "偏移:", cd_offset, "大小:", cd_size)

cd = tail[eocd - cd_size:eocd] if cd_size <= 400000 else None
if cd is None or cd[:4] != b"PK\x01\x02":
    print("中央目录不在尾部 400KB 内,扩大重拉")
    cd = fetch_range(cd_offset, cd_size)
assert cd and cd[:4] == b"PK\x01\x02", "中央目录解析失败"

targets = []
pos = 0
while pos < len(cd) - 46:
    if cd[pos:pos + 4] != b"PK\x01\x02":
        break
    _ver_m, _ver_n, flags, method, _t, _d, _crc, csize, usize, nlen, elen, clen, _disk2, _ia, _ea, lho = struct.unpack(
        "<HHHHHHIIIHHHHHII", cd[pos + 4:pos + 46])
    name = cd[pos + 46:pos + 46 + nlen].decode("utf-8", errors="replace")
    want = ("/scale/" in name or "/arpeggio/" in name) and name.endswith(".wav")
    if want:
        targets.append({"name": name, "offset": lho, "method": method, "csize": csize, "usize": usize,
                        "nlen": nlen, "elen": elen, "flags": flags})
    pos += 46 + nlen + elen + clen

print("目标音阶/琶音文件:", len(targets))
targets = targets[:CAP]

count = 0
names = []
for t in targets:
    head = fetch_range(t["offset"], 30 + t["nlen"] + t["elen"])
    if head is None or head[:4] != b"PK\x03\x04":
        print("  !! 本地头失败", t["name"])
        continue
    data = fetch_range(t["offset"] + 30 + t["nlen"] + t["elen"], t["csize"])
    if data is None:
        print("  !! 数据失败", t["name"])
        continue
    if t["method"] == 8:
        try:
            data = zlib.decompress(data, -15)
        except Exception as e:  # noqa: BLE001
            print("  !! 解压失败", t["name"], e)
            continue
    safe = os.path.basename(t["name"])
    with open(os.path.join(OUT, safe), "wb") as f:
        f.write(data)
    names.append(safe)
    count += 1
    print("  提取 %d %s (%dKB)" % (count, safe, len(data) // 1024), flush=True)

with open(os.path.join(OUT, "_names.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(names))
print("完成:提取 %d 个文件 → %s" % (count, os.path.abspath(OUT)))

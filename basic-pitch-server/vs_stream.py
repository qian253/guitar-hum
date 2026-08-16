# -*- coding: utf-8 -*-
"""vs_stream.py — VocalSet 流式提取:从 curl 管道读 zip 流(只下载前 ~1GB),
只解出 /scale/ 与 /arpeggio/ 子集的 wav(自带调性),其余条目直接跳过。
zip 本地头即可顺序解析,不需要文件末尾的中央目录(截断下载也能用)。
用法: curl -r 0-1000000000 "<url>" | python vs_stream.py [输出目录] [上限文件数]
"""
import os
import sys
import struct
import zlib

sys.stdout.reconfigure(encoding="utf-8")

OUT = sys.argv[1] if len(sys.argv) > 1 else "eval_data/vocalset"
CAP = int(sys.argv[2]) if len(sys.argv) > 2 else 80
os.makedirs(OUT, exist_ok=True)

STDIN = sys.stdin.buffer


def read_exact(n):
    buf = b""
    while len(buf) < n:
        chunk = STDIN.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def skip(n):
    left = n
    while left > 0:
        chunk = STDIN.read(min(left, 1 << 20))
        if not chunk:
            return False
        left -= len(chunk)
    return True


count = 0
names = []
while count < CAP:
    h = read_exact(4)
    if h is None:
        break
    if h == b"PK\x03\x04":
        fh = read_exact(26)
        if fh is None:
            break
        ver, flags, method, modt, modd, crc, csize, usize, nlen, elen = struct.unpack("<HHHHHIIIHH", fh)
        name = read_exact(nlen).decode("utf-8", errors="replace") if nlen else ""
        if elen:
            skip(elen)
        want = ("/scale/" in name or "/arpeggio/" in name) and name.endswith(".wav")
        if want:
            if method not in (0, 8) or (flags & 0x08):
                # 数据描述符/未知压缩法:跳过本条(读 csize,若 csize=0 则跳过 usize)
                n = csize if csize else usize
                skip(n)
                continue
            data = read_exact(csize)
            if data is None:
                break
            if method == 8:
                try:
                    data = zlib.decompress(data, -15)
                except Exception as e:  # noqa: BLE001
                    print("  !! 解压失败", name, e)
                    continue
            safe = os.path.basename(name)
            with open(os.path.join(OUT, safe), "wb") as f:
                f.write(data)
            names.append(safe)
            count += 1
            print("  提取", count, safe, len(data) // 1024, "KB")
        else:
            if not skip(csize if csize else usize):
                break
    elif h == b"PK\x01\x02" or h == b"PK\x05\x06" or h == b"PK\x07\x08":
        break  # 中央目录/结束标记:流到此为止
    else:
        print("  ? 未知块", h.hex(), "停止")
        break

print("共提取", count, "个文件 →", os.path.abspath(OUT))
with open(os.path.join(OUT, "_names.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(names))

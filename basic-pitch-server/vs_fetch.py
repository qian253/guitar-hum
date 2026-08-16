# -*- coding: utf-8 -*-
"""vs_fetch.py — VocalSet 单脚本下载+流式提取(数据描述符 zip 适配版)
VocalSet 的 zip 条目带 data-descriptor(本地头 csize/usize=0,尺寸在数据后)。
策略:method=8 用 zlib 流式解码到 eof 精确定位数据尾;method=0 且尺寸未知则扫描下一个
PK 签名定位。每 50MB 打印进度。"""
import os
import struct
import sys
import urllib.request
import zlib

sys.stdout.reconfigure(encoding="utf-8")

URL = "https://zenodo.org/api/records/1442513/files/VocalSet1-2.zip/content"
OUT = "eval_data/vocalset"
CAP = 80
MAX_BYTES = int(os.environ.get("VS_MAX_BYTES", "1500000000"))

os.makedirs(OUT, exist_ok=True)

import time

def open_conn(offset):
    req = urllib.request.Request(URL, headers={"Range": "bytes=%d-%d" % (offset, MAX_BYTES - 1)})
    return urllib.request.urlopen(req, timeout=60)

resp = open_conn(0)
print("已连接,开始流式解析(上限 %.1fGB,断线自动续传)" % (MAX_BYTES / 1e9), flush=True)

read_total = 0
buf = b""


def read_chunk():
    """读一块(1MB),断线自动从当前偏移续传,重试最多 10 次"""
    global resp, read_total
    for _ in range(10):
        try:
            chunk = resp.read(min(1 << 20, MAX_BYTES - read_total))
            read_total += len(chunk)
            return chunk
        except Exception as e:  # noqa: BLE001
            print("  连接中断 @%dMB,续传重试… (%s)" % (read_total // 1024 // 1024, e), flush=True)
            try:
                resp.close()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(2)
            resp = open_conn(read_total)
    return b""


def read_exact(n):
    global read_total, buf
    while len(buf) < n:
        chunk = read_chunk()
        if not chunk:
            return None
        buf += chunk
    out, buf = buf[:n], buf[n:]
    return out


def read_until_sig():
    """读数据直到遇到 PK 签名;返回 (data, sig)"""
    global read_total, buf
    data = bytearray()
    while True:
        i = buf.find(b"PK\x03\x04")
        j = buf.find(b"PK\x01\x02")
        k = buf.find(b"PK\x05\x06")
        hits = [x for x in (i, j, k) if x >= 0]
        if hits:
            pos = min(hits)
            data += buf[:pos]
            sig = buf[pos:pos + 4]
            buf = buf[pos + 4:]
            return bytes(data), sig
        data += buf
        buf = b""
        chunk = read_chunk()
        if not chunk:
            return bytes(data), None
        buf = chunk


def consume_descriptor():
    """deflate eof 后,消费紧随的数据描述符(PK0708+12 或 zip64+8)"""
    global buf
    h = read_exact(4)
    if h is None:
        return
    if h == b"PK\x07\x08":
        read_exact(12)
        # zip64 判断:读完 12 字节后若下 4 字节不是 PK 签名,再读 8 字节
        peek = read_exact(4)
        if peek and peek[:4] not in (b"PK\x03\x04", b"PK\x01\x02", b"PK\x05\x06"):
            read_exact(8)
        buf = (peek or b"") + buf
    else:
        buf = h + buf  # 不是描述符,把字节塞回去(防御)


count = 0
names = []
last_mark = 0

while count < CAP and read_total < MAX_BYTES:
    if read_total - last_mark >= 50 * 1024 * 1024:
        last_mark = read_total
        print("  已下载 %dMB,已提取 %d 个" % (read_total // 1024 // 1024, count), flush=True)
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
            read_exact(elen)
        want = ("_scales_" in name or "_arpeggios_" in name) and "piano" not in name and ("straight" in name or "belt" in name) and name.endswith(".wav")
        has_desc = bool(flags & 0x08)
        data = None
        if method == 8:
            # deflate:流式解码定位数据尾
            d = zlib.decompressobj(-15)
            out = bytearray()
            eof = False
            while not eof and read_total < MAX_BYTES:
                chunk = read_exact(1 << 16)
                if chunk is None:
                    break
                try:
                    out += d.decompress(chunk)
                except zlib.error:
                    break  # 坏流:交给下面重同步
                if d.eof:
                    eof = True
                    if d.unused_data:
                        buf = d.unused_data + buf
            if eof:
                data = bytes(out)
                consume_descriptor()
            else:
                # 解不出来:签名扫描重同步,本条按空数据处理(保存时校验 wav 头)
                _d2, _sig2 = read_until_sig()
                if _sig2 in (b"PK", b"PK"):
                    buf = _sig2 + buf
                data = b""
        elif method == 0 and not (has_desc and csize == 0 and usize == 0):
            data = read_exact(csize)
        else:
            data, sig = read_until_sig()
            if sig == b"PK\x01\x02" or sig == b"PK\x05\x06":
                buf = sig + buf  # 中央目录/结束:塞回去退出
        if data is None:
            break
        if want and len(data) > 44 and data[:4] == b"RIFF":
            safe = os.path.basename(name)
            with open(os.path.join(OUT, safe), "wb") as f:
                f.write(data)
            names.append(safe)
            count += 1
            print("  提取 %d %s (%dKB)" % (count, safe, len(data) // 1024), flush=True)
    elif h in (b"PK\x01\x02", b"PK\x05\x06", b"PK\x07\x08"):
        break
    else:
        if not hasattr(sys, "__rsync") or sys.__rsync < 5:
            sys.__rsync = getattr(sys, "__rsync", 0) + 1
            print("  ? 未知块", h.hex()[:16], "重同步 %d/5" % sys.__rsync, flush=True)
            _d, _sig = read_until_sig()
            continue
        print("  ? 未知块", h.hex()[:16], "重同步耗尽,停止")
        break

with open(os.path.join(OUT, "_names.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(names))
print("完成:下载 %dMB,提取 %d 个文件 → %s" % (read_total // 1024 // 1024, count, os.path.abspath(OUT)))

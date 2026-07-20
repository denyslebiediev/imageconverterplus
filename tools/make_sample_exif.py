#!/usr/bin/env python3
"""Strip ALL metadata from a JPEG and inject a fully synthetic EXIF APP1.

The sample photo bundled with the landing page's EXIF-inspector demo must
carry only fabricated data (neutral landmark GPS, generic device fields) —
never the original camera EXIF. Usage:

    python3 make_sample_exif.py <in.jpg> <out.jpg>
"""
import struct
import sys

# --- synthetic data: Eiffel Tower area, generic iPhone fields -----------------
MAKE = "Apple"
MODEL = "iPhone 15 Pro"
SOFTWARE = "iOS 18.3"
DATETIME = "2026:03:04 09:41:07"
LENS = "iPhone 15 Pro back triple camera 6.86mm f/1.78"
LAT = (48, 51, 30.13)   # 48°51'30.13" N
LON = (2, 17, 40.13)    # 2°17'40.13" E
ALT_M = 34.0

ASCII, SHORT, LONG, RATIONAL, SRATIONAL = 2, 3, 4, 5, 10


def entry(tag, typ, values):
    return (tag, typ, values)


def build_ifd(entries, tiff, next_off, data_area_start):
    """Serialize one IFD at next_off; returns (ifd_bytes, data_bytes, end_off)."""
    out = struct.pack(">H", len(entries))
    data = b""
    data_off = data_area_start
    for tag, typ, val in entries:
        if typ == ASCII:
            raw = val.encode() + b"\x00"
            count = len(raw)
            size = count
        elif typ == SHORT:
            raw = b"".join(struct.pack(">H", v) for v in val)
            count = len(val)
            size = 2 * count
        elif typ == LONG:
            raw = b"".join(struct.pack(">I", v) for v in val)
            count = len(val)
            size = 4 * count
        elif typ in (RATIONAL, SRATIONAL):
            raw = b"".join(struct.pack(">II", n, d) for n, d in val)
            count = len(val)
            size = 8 * count
        if size <= 4:
            out += struct.pack(">HHI", tag, typ, count) + raw.ljust(4, b"\x00")
        else:
            out += struct.pack(">HHII", tag, typ, count, data_off)
            data += raw
            data_off += len(raw)
    out += struct.pack(">I", next_off)
    return out, data


def rat(f, den=1000):
    return (int(round(f * den)), den)


def build_exif():
    # Layout: header(8) | IFD0 | IFD0 data | ExifIFD | data | GPSIFD | data
    ifd0_entries = [
        entry(0x010F, ASCII, MAKE),
        entry(0x0110, ASCII, MODEL),
        entry(0x0112, SHORT, [1]),
        entry(0x0131, ASCII, SOFTWARE),
        entry(0x0132, ASCII, DATETIME),
        entry(0x8769, LONG, [0]),   # Exif IFD pointer, patched below
        entry(0x8825, LONG, [0]),   # GPS IFD pointer, patched below
    ]
    exif_entries = [
        entry(0x829A, RATIONAL, [(1, 120)]),          # ExposureTime 1/120
        entry(0x829D, RATIONAL, [(178, 100)]),        # FNumber f/1.78
        entry(0x8827, SHORT, [80]),                   # ISO
        entry(0x9003, ASCII, DATETIME),               # DateTimeOriginal
        entry(0x9004, ASCII, DATETIME),               # CreateDate
        entry(0x920A, RATIONAL, [rat(6.86, 100)]),    # FocalLength
        entry(0xA434, ASCII, LENS),                   # LensModel
    ]
    gps_entries = [
        entry(0x0001, ASCII, "N"),
        entry(0x0002, RATIONAL, [rat(LAT[0], 1), rat(LAT[1], 1), rat(LAT[2])]),
        entry(0x0003, ASCII, "E"),
        entry(0x0004, RATIONAL, [rat(LON[0], 1), rat(LON[1], 1), rat(LON[2])]),
        entry(0x0005, ASCII, "0"),                    # altitude ref: above sea level (byte-as-ascii ok for demo)
        entry(0x0006, RATIONAL, [rat(ALT_M, 10)]),
    ]

    def sized(entries):
        # 2 count + 12/entry + 4 next; overflow data appended after
        base = 2 + 12 * len(entries) + 4
        return base

    ifd0_at = 8
    ifd0_base = sized(ifd0_entries)
    # first pass to learn data sizes
    _, d0 = build_ifd(ifd0_entries, None, 0, 0)
    exif_at = ifd0_at + ifd0_base + len(d0)
    _, dE = build_ifd(exif_entries, None, 0, 0)
    gps_at = exif_at + sized(exif_entries) + len(dE)

    ifd0_entries[5] = entry(0x8769, LONG, [exif_at])
    ifd0_entries[6] = entry(0x8825, LONG, [gps_at])

    i0, d0 = build_ifd(ifd0_entries, None, 0, ifd0_at + ifd0_base)
    ie, de = build_ifd(exif_entries, None, 0, exif_at + sized(exif_entries))
    ig, dg = build_ifd(gps_entries, None, 0, gps_at + sized(gps_entries))

    tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + i0 + d0 + ie + de + ig + dg
    return b"Exif\x00\x00" + tiff


def main(src, dst):
    jpg = open(src, "rb").read()
    assert jpg[:2] == b"\xff\xd8", "not a JPEG"
    # walk segments, drop all APPn except APP0(JFIF)/APP2(ICC), drop COM
    out = [b"\xff\xd8"]
    i = 2
    while i < len(jpg):
        if jpg[i] != 0xFF:
            break
        while jpg[i + 1] == 0xFF:   # spec allows 0xFF fill bytes before a marker
            i += 1
        marker = jpg[i + 1]
        if marker == 0xDA:          # SOS: keep scan, truncate at first EOI —
            tail = jpg[i:]          # trailing payloads (gain maps, motion MP4s,
            end = tail.find(b"\xff\xd9")  # Extended-XMP) live after EOI
            out.append(tail[:end + 2] if end != -1 else tail)
            break
        length = struct.unpack(">H", jpg[i + 2:i + 4])[0]
        seg = jpg[i:i + 2 + length]
        keep = True
        if 0xE0 <= marker <= 0xEF:
            # plain JFIF APP0 only (JFXX APP0 can embed original thumbnails)
            keep = ((marker == 0xE0 and seg[4:9] == b"JFIF\x00")
                    or (marker == 0xE2 and b"ICC_PROFILE" in seg[:20]))
        if marker == 0xFE:          # COM
            keep = False
        if keep:
            out.append(seg)
        i += 2 + length
    exif = build_exif()
    app1 = b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif
    # APP1 must follow SOI (after optional APP0)
    head = out[0]
    rest = out[1:]
    if rest and rest[0][1:2] == b"\xe0":
        result = head + rest[0] + app1 + b"".join(rest[1:])
    else:
        result = head + app1 + b"".join(rest)
    open(dst, "wb").write(result)
    print(f"wrote {dst}: {len(result)} bytes, EXIF {len(exif)} bytes")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

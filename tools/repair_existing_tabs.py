"""沿用末刀橋位，修復既有 G-code 較早深切刀次；不重新計算 CAM。"""

import argparse
import difflib
import hashlib
import json
import math
import re
from pathlib import Path


def xy(line):
    """取得明確指定的平面座標。"""
    match = re.search(r"X(-?[\d.]+) Y(-?[\d.]+)", line)
    return tuple(map(float, match.groups())) if match else None


def geometry(line):
    """移除高度與走速，保留原始平面指令。"""
    return re.sub(r" Z[^ ]+| F[^ ]+", "", line)


def distance(point, start, end):
    """計算點到線段的距離。"""
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = dx * dx + dy * dy
    t = max(0, min(1, ((point[0]-start[0])*dx + (point[1]-start[1])*dy)/length)) if length else 0
    return math.hypot(point[0]-start[0]-t*dx, point[1]-start[1]-t*dy)


def repair(data):
    """只修復具有相同輪廓及明確橋頂的前置刀次，條件不符即拒絕。"""
    lines = data.decode('utf-8-sig').splitlines()
    boundaries = [i for i, line in enumerate(lines) if line.startswith('G0 Z')]
    edits, report = [], []
    for begin, end in zip(boundaries, boundaries[1:]):
        starts = [i for i in range(begin, end) if re.fullmatch(r'G1 Z-[\d.]+ F[\d.]+', lines[i])]
        if len(starts) < 2:
            continue
        final = lines[starts[-1]+1:end]
        tab_z = [float(re.search(r' Z(-?[\d.]+)', line)[1]) for line in final if ' Z' in line]
        if not tab_z:
            continue
        bottom = float(re.search(r' Z(-?[\d.]+)', lines[starts[-1]])[1])
        top = max(tab_z)
        if not bottom < top < 0 or set(tab_z) != {bottom, top}:
            raise ValueError('橋位高度不明確，停止修復')
        if any(not line.startswith('G1 X') or xy(line) is None for line in final):
            raise ValueError('末刀包含未支援指令，停止修復')
        for index, start in enumerate(starts[:-1]):
            depth = float(re.search(r' Z(-?[\d.]+)', lines[start])[1])
            if depth >= top:
                continue
            stop = starts[index+1]
            original = lines[start+1:stop]
            if any(' Z' in line for line in original):
                raise ValueError('前刀已有高度變化，停止修復')
            old_xy, new_xy = list(map(geometry, original)), list(map(geometry, final))
            max_error = 0
            for tag, a, b, c, d in difflib.SequenceMatcher(None, old_xy, new_xy, autojunk=False).get_opcodes():
                if tag == 'equal':
                    continue
                if tag != 'insert' or a == 0 or a == len(original):
                    raise ValueError('輪廓不同，禁止變更既有位置')
                for line in final[c:d]:
                    error = distance(xy(line), xy(original[a-1]), xy(original[a]))
                    max_error = max(max_error, error)
                    if error > 0.0015:
                        raise ValueError('新增分段超過原始三位小數精度')
            replacement = [re.sub(r' Z(-?[\d.]+)', lambda m: f' Z{max(depth, float(m[1])):.3f}', line) for line in final]
            # 原來的切削走速必須逐字保留。
            if re.findall(r' F[\d.]+', '\n'.join(original)) != re.findall(r' F[\d.]+', '\n'.join(replacement)):
                raise ValueError('走速不同，停止修復')
            edits.append((start+1, stop, replacement))
            report.append({'line': start+1, 'depth': depth, 'tab_top': top, 'max_xy_error_mm': max_error,
                           'tabs': sum(f' Z{top:.3f}' in line for line in replacement)})
    if not edits:
        raise ValueError('未找到符合條件的橋位修復')
    for start, stop, replacement in reversed(edits):
        lines[start:stop] = replacement
    return ('\r\n'.join(lines)+'\r\n').encode(), report


def main():
    """讀取來源並將修正版及核對報告另存於專案內。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if not output.is_relative_to(root) or output == args.source.resolve() or output.exists():
        raise ValueError('必須指定專案內尚不存在的新檔案')
    data = args.source.read_bytes()
    corrected, details = repair(data)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(corrected)
    report = {'source': str(args.source), 'sha256_before': hashlib.sha256(data).hexdigest(),
              'sha256_after': hashlib.sha256(corrected).hexdigest(), 'repairs': details}
    output.with_suffix('.verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

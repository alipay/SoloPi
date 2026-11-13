"""Offline evidence gallery for a single Android verification attempt."""

import html
import json
from pathlib import Path
from urllib.parse import quote


def export_report(report, root, *, title="SoloPi 视觉回归证据"):
    root = Path(root).resolve(strict=True)
    figures = []
    for raw in sorted(root.rglob("*.png")):
        path = raw.resolve(strict=True)
        # Code security: only this attempt's regular files, never external URLs/symlinks.
        if raw.is_symlink() or not path.is_relative_to(root) or not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        href = html.escape(quote(relative, safe="/"), quote=True)
        label = html.escape(relative)
        figures.append('<figure><a href="' + href + '"><img src="' + href
                       + '" alt="本次运行原始整屏截图"></a><figcaption>' + label + '</figcaption></figure>')
    # Code security: static, script-free export escapes every report-derived value.
    status = html.escape(str(report.get("status", "not_tested")))
    title = html.escape(str(title))
    details = html.escape(json.dumps(report, ensure_ascii=False, indent=2))
    target = root / "report.html"
    with target.open("x", encoding="utf-8") as stream:
        stream.write('''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>''' + title + '''</title><style>body{font-family:system-ui;margin:32px auto;max-width:1100px;padding:16px}figure{text-align:center;margin:24px auto}img{width:100%;max-width:420px;height:auto}figcaption{font-size:12px;color:#555;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px}</style>
<h1>''' + title + '</h1><p>固定验收结果：' + status
                     + '</p><p>下列截图来自本次执行，保留完整屏幕；点击查看原图。采集失败或不稳定时也可能保留现场图，图片存在不代表验收通过。</p>'
                     + '<p><a href="report.json">最终验收 JSON</a> · <a href="timing.json">完整分阶段计时</a></p>'
                     + ''.join(figures) + '<h2>固定验收、动作回执与证据索引</h2><pre>' + details + '</pre></html>\n')
    target.chmod(0o600)
    return target

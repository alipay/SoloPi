"""Offline native report with original, uncropped screenshots from one run."""

import html
import json
import re
from pathlib import Path
from typing import Any, Mapping


def export_report(report: Mapping[str, Any], root: Path) -> Path:
    root = root.resolve()
    pictures = []
    for item in report.get("evidence", []):
        if item.get("type") != "screenshot":
            continue
        path = Path(item.get("content", {}).get("path", "")).resolve()
        # Code security: generated local PNGs only; never embed a provider-supplied URL/path.
        if path.parent != root or not re.fullmatch(r"screen-\d{4,}-[0-9a-f]{12}\.png", path.name) or not path.is_file():
            continue
        name = html.escape(path.name, quote=True)
        pictures.append('<figure><a href="' + name + '"><img src="' + name + '" alt="原始整屏截图"></a><figcaption>' + name + '</figcaption></figure>')
    # Code security: this is a non-template static export; escape all report data.
    status = html.escape(str(report.get("status", "not_tested")))
    details = html.escape(json.dumps({key: value for key, value in report.items() if key != "evidence"}, ensure_ascii=False, indent=2))
    output = root / "report.html"
    output.write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>SoloPi 原生回归报告</title><style>body{font-family:system-ui;margin:32px auto;max-width:1100px;padding:16px}figure{margin:24px auto;text-align:center}img{width:100%;max-width:480px;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px}figcaption{font-size:12px;color:#555}</style>
<h1>SoloPi 原生回归报告</h1><p>结果：''' + status + '</p><p>截图保留完整屏幕；点击可打开原图。JSON 包含独立验收结果，原始观察与回执保存在 report.json。</p>'
                      + ''.join(pictures) + '<h2>验收与执行摘要</h2><pre>' + details + '</pre></html>\n', encoding="utf-8")
    return output

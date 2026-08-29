"""CSS 清单守卫：拦住"静默丢样式"这一整类退化。

起因：M2 整份重写 monitor.html 时丢了 @keyframes blink，而 .cursor 仍引用
animation-name: blink。浏览器对不存在的动画名不报错，元素只是永远停在实心，
所以几何量测和数据回归全都发现不了它。

检查两件事：
  1. 每个 animation-name 都有对应的 @keyframes
  2. 每个 var(--x) 都在 :root（或同文件别处）有定义
并用一个故意做坏的样例验证检查器本身不是空转的。
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS_SOURCES = [ROOT / "monitor.html"]

ANIM_USE = re.compile(r"animation(?:-name)?\s*:\s*([^;}]+)")
KEYFRAMES = re.compile(r"@keyframes\s+([A-Za-z0-9_-]+)")
VAR_USE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)")
VAR_DEF = re.compile(r"(--[A-Za-z0-9_-]+)\s*:")
CSS_WORDS = {"none", "inherit", "initial", "unset", "infinite", "linear", "ease",
             "ease-in", "ease-out", "ease-in-out", "forwards", "backwards", "both",
             "alternate", "alternate-reverse", "normal", "reverse"}


def css_body(text):
    """只取 <style> 里的内容，避免把 JS 字符串当成样式。"""
    blocks = re.findall(r"<style>(.*?)</style>", text, re.S)
    return "\n".join(blocks) if blocks else text


def audit(text):
    body = css_body(text)
    # 注释里可能出现 var(--x) 字样，先剥掉注释再找引用
    clean = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    defined_anim = set(KEYFRAMES.findall(clean))
    defined_var = set(VAR_DEF.findall(clean))
    problems = []

    for decl in ANIM_USE.findall(clean):
        for tok in decl.split(","):
            name = tok.strip().split()[0].lower() if tok.strip() else ""
            if not name or name in CSS_WORDS or name.startswith("var("):
                continue
            if name not in defined_anim:
                problems.append(f"animation-name {name!r} 没有对应的 @keyframes")

    for var in set(VAR_USE.findall(clean)):
        if var not in defined_var:
            problems.append(f"{var} 被引用但未定义")

    return problems


def main():
    failed = []
    total = 0
    for path in CSS_SOURCES:
        if not path.is_file():
            print(f"  skip {path.name} 不存在")
            continue
        problems = audit(path.read_text(encoding="utf-8"))
        total += 1
        if problems:
            failed.append(path.name)
            print(f"  FAIL {path.name}")
            for p in problems:
                print(f"        {p}")
        else:
            print(f"  ok   {path.name} 的动画名与 CSS 变量都有定义")

    # 自检：故意做坏的样例必须被抓到，否则这个守卫是空转的
    bad = audit("<style>.a{animation: nope 1s infinite}.b{color:var(--ghost)}</style>")
    if len(bad) == 2:
        print("  ok   自检：故意做坏的样式确实被抓到")
    else:
        print(f"  FAIL 自检：应报 2 个问题，实际 {len(bad)} -> {bad}")
        failed.append("self-check")

    print(f"\n检查 {total} 个文件，失败 {len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

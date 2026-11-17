# Збирає index.html з частин src/ (CSS-доповнення + скрипт)
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
p = root / "index.html"; s = p.read_text(encoding="utf-8")
src = root / "src"
files = ["0-api.js", "1-model.js", "2-state.js", "3-views.js", "4-views2.js", "5-ai-router.js"] + sorted(f.name for f in src.glob("[6-9]-*.js"))
js = "\n".join((src / f).read_text(encoding="utf-8") for f in files)
css = "\n".join((src / f).read_text(encoding="utf-8") for f in ["extra.css"] + sorted(f.name for f in src.glob("extra-*.css")))
a, b = s.index("<script>"), s.index("</script>")
s = s[:a] + "<script>\n" + js + "</script>" + s[b + len("</script>"):]
a, b = s.index("/* ---- v2:"), s.index("@media (max-width: 1180px) {\n  .c3")
s = s[:a] + css + "\n" + s[b:]
p.write_text(s, encoding="utf-8")
print("built", len(s))

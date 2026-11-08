# Merges a ChatGPT patch (//@@REPLACE name, //@@ADD, //@@CSS sections) into the userscript.
# Usage: python3 merge.py <base.user.js> <reply.txt> <out.user.js> <version>
import re
import sys

base_path, reply_path, out_path, version = sys.argv[1:5]
s = open(base_path, encoding="utf8").read()
r = open(reply_path, encoding="utf8").read()
first = r.index("//@@")
body = r[first:]
body = re.split(r"\n(?:这版|该版本|以上|说明|注意)[^\n]*\n?", body)[0] if False else body
parts = re.split(r"^//@@(REPLACE [A-Za-z_]\w*|ADD|CSS)[ \t]*$", body, flags=re.M)
print("preface:", repr(r[:first][-60:]))
sections = [(parts[i].strip(), parts[i + 1].strip("\n")) for i in range(1, len(parts), 2)]


def block_end(src, start):
    """Index just past the brace that closes the block opening at or after start."""
    i = src.index("{", start)
    depth = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c in "'\"":
            q = c
            i += 1
            while src[i] != q:
                i += 2 if src[i] == "\\" else 1
        elif c == "`":
            i += 1
            while src[i] != "`":
                if src[i] == "\\":
                    i += 2
                elif src.startswith("${", i):
                    i = block_end(src, i)
                else:
                    i += 1
        elif src.startswith("//", i):
            i = src.index("\n", i)
        elif src.startswith("/*", i):
            i = src.index("*/", i) + 1
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError("unbalanced block")


def indent(code):
    return "\n".join(("        " + l if l.strip() else l) for l in code.split("\n"))


adds = []
css = []
for kind, code in sections:
    if kind.startswith("REPLACE"):
        name = kind.split()[1]
        m = re.search(r"^[ \t]*(?:function " + name + r"\(|" + name + r" = function \()", s, flags=re.M)
        if not m:
            raise SystemExit("function not found: " + name)
        # Skip past the parameter list so default values cannot be mistaken for the body.
        end = block_end(s, s.index(")", m.end() - 1))
        if s[end] == ";":
            end += 1
        code = code.rstrip()
        s = s[: m.start()] + indent(code.lstrip()) + s[end:]
        print("replaced", name)
    elif kind == "ADD":
        adds.append(code.rstrip())
    else:
        # The reply may carry trailing notes after the code; CSS is always the last section.
        css.append(code.rstrip())

if adds:
    marker = re.search(r"^[ \t]*function createTweet\(", s, flags=re.M)
    s = s[: marker.start()] + indent("\n\n".join(adds)) + "\n\n" + s[marker.start() :]
    print("added helpers", len(adds))
if css:
    joined = "\n".join(css)
    if "`" in joined or "${" in joined:
        raise SystemExit("CSS contains a backtick or ${")
    a = s.index("const CSS = `")
    end = s.index("\n`;", a)
    s = s[:end] + "\n" + joined + s[end:]
    print("css bytes", len(joined))

s = re.sub(r"// @version      [\d.]+", "// @version      " + version, s, count=1)
open(out_path, "w", encoding="utf8").write(s)

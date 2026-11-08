# Pulls the userscript out of a saved ChatGPT reply.
import sys
s = open(sys.argv[1], encoding="utf8").read()
a = s.index("// ==UserScript==")
b = s.rindex("})();") + 5
open(sys.argv[2], "w", encoding="utf8").write(s[a:b] + "\n")
print("before:", repr(s[:a][-120:]))
print("after:", repr(s[b:][:200]))

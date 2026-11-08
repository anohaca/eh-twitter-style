// Minimal CDP client for the ChatGPT tab, using only Node built-ins.
// Usage: node chatgpt.mjs status
//        node chatgpt.mjs new
//        node chatgpt.mjs read
//        node chatgpt.mjs send "message"
//        node chatgpt.mjs send-file prompt.md
import { readFileSync } from "node:fs";
const [rawMode, arg] = process.argv.slice(2);
const mode = rawMode === "send-file" ? "send" : rawMode;
const message = rawMode === "send-file" ? readFileSync(arg, "utf8") : arg;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const tab = tabs.find((t) => t.type === "page" && t.url.includes("chatgpt.com"));
if (!tab) throw new Error("No chatgpt.com tab found");

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

const statusExpr = `(() => {
  const q = (s) => document.querySelector(s);
  const buttons = [...document.querySelectorAll('a,button')].map((b) => b.innerText.trim()).filter(Boolean);
  return {
    title: document.title,
    url: location.href,
    composer: !!q('[contenteditable=true][role=textbox]'),
    loginButton: !!q('[data-testid="login-button"]'),
    profileButton: !!q('[data-testid="accounts-profile-button"]'),
    challenge: /verify you are human|cloudflare/i.test(document.body.innerText),
    buttons: buttons.slice(0, 12),
  };
})()`;

// Latest assistant message on the page. Older turns may be virtualized out of
// the DOM, so new replies are detected by message id rather than by count.
const lastReplyExpr = `(() => {
  const heads = document.querySelectorAll('h4[data-conversation-role="assistant"]');
  const head = heads[heads.length - 1];
  if (!head) return { id: "", text: "", complete: false };
  const unit = head.parentElement;
  const roots = unit.querySelectorAll('[data-markdown-text-style="assistant-message"]');
  return {
    id: unit.getAttribute('data-chatgpt-search-message-ids') || "",
    text: [...roots].map((r) => r.innerText.trim()).filter(Boolean).join("\\n\\n"),
    complete: head.closest('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state') === 'complete',
  };
})()`;

if (mode === "new") {
  await send("Page.navigate", { url: "https://chatgpt.com/" });
  await sleep(1500);
  for (let i = 0; i < 30; i++) {
    if (await evaluate(`!!document.querySelector('[contenteditable=true][role=textbox]')`)) break;
    await sleep(1000);
  }
  console.log(JSON.stringify(await evaluate(statusExpr), null, 2));
} else if (mode === "status") {
  console.log(JSON.stringify(await evaluate(statusExpr), null, 2));
} else if (mode === "read") {
  const reply = await evaluate(lastReplyExpr);
  if (!reply?.text) {
    console.error("No assistant reply found on page");
    process.exitCode = 1;
  } else {
    console.log(reply.text);
  }
} else if (mode === "send") {
  const before = (await evaluate(lastReplyExpr)).id;
  await evaluate(`(() => {
    const el = document.querySelector('[contenteditable=true][role=textbox]');
    el.focus();
    document.execCommand('insertText', false, ${JSON.stringify(message)});
  })()`);
  await sleep(500);
  const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...enter });
  await send("Input.dispatchKeyEvent", { type: "char", text: "\r", ...enter });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...enter });

  let last = "";
  let stable = 0;
  for (let i = 0; i < 900 && stable < 3; i++) {
    await sleep(1000);
    const reply = await evaluate(lastReplyExpr);
    const fresh = reply && reply.id && reply.id !== before;
    const text = fresh ? reply.text : "";
    stable = text && text === last && reply.complete ? stable + 1 : 0;
    last = text;
  }
  if (stable < 3) {
    console.error(`Timed out waiting for a finished reply; partial text: ${last || "(none)"}`);
    process.exitCode = 1;
  } else {
    console.log(last);
  }
}
ws.close();

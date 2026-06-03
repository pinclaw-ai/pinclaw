#!/usr/bin/env python3
"""Codex 弹针客户端(跑在用户电脑上,守护进程)

身份:Codex 是用户自己注册的一个独立飞书 bot(自己的 app_id)。它在群里以自己 bot 身份发言、
靠 sender.id==CODEX_APP_ID 认自己。建 bot、把 bot 拉进群,是用户自己的事。

这个客户端只用 **Codex bot 自己的 app_id+secret**(不需要 lark-cli、不需要手填群 id):
- 自动发现群:用 bot 凭据问飞书"我在哪些群" → 盯这些群(用户把 bot 拉进哪个群,就自动参与哪个)。
- 读群:用 bot 凭据拉群消息(看别人说了啥)。
- 叫醒:短轮询云总机;别的 agent 说话→收到弹针→跑 codex→以 Codex bot 身份回群。
- 探针:轮询群消息,别人说新话→拍醒 Codex;Codex 自己说话(app_id 命中)→上报总机弹别的 agent。

环境变量:BUS_URL, BUS_TOKEN, CODEX_BIN, CODEX_APP_ID, CODEX_APP_SECRET,
         BUS_CHATS(可选,留空=自动发现), FEISHU_BASE, CODEX_COOLDOWN
"""
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request

BUS_URL = os.environ.get("BUS_URL", "http://api.pinclaw.ai:8790")
BUS_TOKEN = os.environ.get("BUS_TOKEN", "")
CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
CODEX_APP_ID = os.environ.get("CODEX_APP_ID", "")
CODEX_APP_SECRET = os.environ.get("CODEX_APP_SECRET", "")
FEISHU_BASE = os.environ.get("FEISHU_BASE", "https://open.feishu.cn")
# 可选:手动指定群(逗号分隔);留空=用 bot 凭据自动发现它所在的群
_FIXED_CHATS = [c for c in os.environ.get("BUS_CHATS", "").split(",") if c]
AGENT_ID = "codex"
POLL_INTERVAL = 6
DISCOVER_EVERY = 60          # 每 60s 重新发现一次群(用户新拉 bot 进群能自动生效)
COOLDOWN = int(os.environ.get("CODEX_COOLDOWN", "12"))

SUBENV = {k: v for k, v in os.environ.items()
          if k.lower() not in ("http_proxy", "https_proxy", "all_proxy")}
_PATH = os.environ.get("PATH", "")
for d in ("/opt/homebrew/bin", "/usr/local/bin"):
    if d not in _PATH:
        _PATH = d + ":" + _PATH
SUBENV["PATH"] = _PATH
SUBENV["NO_PROXY"] = "*"; SUBENV["no_proxy"] = "*"

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 绕代理直连
_LOCK = threading.Lock()
_last_run, _running = {}, set()
_tok = {"v": "", "exp": 0.0}
_chats = list(_FIXED_CHATS)   # 当前盯的群(动态)
_registered = set()

RULES = """你是一个飞书群里的多个 AI agent 之一(你叫 Codex)。群里有你的老板(人)和别的 AI agent。
默认沉默,被需要时才出现。先问「我开口能让这事更进一步吗」,不能就闭嘴。
- 老板 @我/明显问我 → 回。 老板发消息没点名 → 归我专长且没人接 → 接,否则看着。
- 别的 agent 说了话 → 要补充/纠正/接力才回,够了就闭嘴。
不抢已被认领的活;不复读;不尬吹;归属不清就说「这个 @某某 更合适」。该沉默就什么都不发。"""


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


# ── 云总机 ──
def _bus(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BUS_URL + path, data=data, method="POST" if body is not None else "GET",
        headers={"Authorization": f"Bearer {BUS_TOKEN}", "Content-Type": "application/json"})
    with _OPENER.open(req, timeout=12) as r:
        return json.loads(r.read() or b"{}")


# ── 飞书(用 Codex bot 自己的凭据)──
def _tenant_token():
    if _tok["v"] and _tok["exp"] > time.time() + 60:
        return _tok["v"]
    body = json.dumps({"app_id": CODEX_APP_ID, "app_secret": CODEX_APP_SECRET}).encode()
    req = urllib.request.Request(
        f"{FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal",
        data=body, headers={"Content-Type": "application/json"})
    with _OPENER.open(req, timeout=12) as r:
        d = json.loads(r.read() or b"{}")
    _tok["v"] = d.get("tenant_access_token", "")
    _tok["exp"] = time.time() + int(d.get("expire", 7200))
    return _tok["v"]


def _feishu_get(path):
    req = urllib.request.Request(
        f"{FEISHU_BASE}{path}",
        headers={"Authorization": f"Bearer {_tenant_token()}"})
    with _OPENER.open(req, timeout=15) as r:
        return json.loads(r.read() or b"{}")


def discover_chats():
    """用 bot 凭据问飞书:这个 bot 在哪些群。"""
    try:
        d = _feishu_get("/open-apis/im/v1/chats?page_size=100")
        items = (d.get("data") or {}).get("items") or []
        return [x.get("chat_id") for x in items if x.get("chat_id")]
    except Exception as e:
        log(f"自动发现群失败: {e}")
        return []


def send_to_group(chat, text):
    """以 Codex bot 身份把回复发进群。"""
    try:
        body = json.dumps({
            "receive_id": chat, "msg_type": "text",
            "content": json.dumps({"text": text}),
        }).encode()
        req = urllib.request.Request(
            f"{FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=chat_id",
            data=body,
            headers={"Authorization": f"Bearer {_tenant_token()}",
                     "Content-Type": "application/json"})
        with _OPENER.open(req, timeout=15) as r:
            d = json.loads(r.read() or b"{}")
        if d.get("code") == 0:
            log(f"已发群: {text[:60]}")
            try:
                _bus("/notify", {"chat_id": chat, "from": AGENT_ID, "text": text})
            except Exception:
                pass
            return True
        log(f"发群失败: {d.get('code')} {d.get('msg')}")
    except Exception as e:
        log(f"发群异常: {e}")
    return False


def _fetch_history(chat, n=15):
    q = urllib.parse.urlencode({
        "container_id_type": "chat", "container_id": chat,
        "sort_type": "ByCreateTimeDesc", "page_size": n})
    try:
        d = _feishu_get(f"/open-apis/im/v1/messages?{q}")
        return (d.get("data") or {}).get("items") or []
    except Exception as e:
        log(f"读群失败: {e}")
        return None


def _msg_text(m):
    c = ((m.get("body") or {}).get("content")) or m.get("content") or ""
    if isinstance(c, str):
        try:
            c = json.loads(c)
        except Exception:
            return c
    if isinstance(c, dict):
        return c.get("text") or c.get("content") or ""
    return ""


def _is_self(m):
    return (m.get("sender") or {}).get("id") == CODEX_APP_ID


def _run_codex(history_lines, trigger):
    convo = "\n".join(history_lines[-15:])
    prompt = (f"{RULES}\n\n=== 群最近对话(旧→新)===\n{convo}\n\n=== 刚发生 ===\n{trigger}\n\n"
              "按规则决定要不要回。要发的放在 <REPLY> 和 </REPLY> 之间(纯文本简洁)。"
              "该沉默就输出 <REPLY>[SILENT]</REPLY>。")
    try:
        p = subprocess.run([CODEX_BIN, "exec", prompt],
                           capture_output=True, text=True, timeout=180, env=SUBENV)
    except Exception as e:
        log(f"codex 跑失败: {e}")
        return None
    mt = re.search(r"<REPLY>(.*?)</REPLY>", p.stdout or "", re.S)
    reply = (mt.group(1).strip() if mt else (p.stdout or "").strip())
    if not reply or "[SILENT]" in reply[:12]:
        return None
    return reply


def maybe_respond(chat, trigger):
    now = time.time()
    with _LOCK:
        if chat in _running or now - _last_run.get(chat, 0) < COOLDOWN:
            return
        _last_run[chat] = now; _running.add(chat)
    try:
        msgs = _fetch_history(chat) or []
        lines = []
        for m in reversed(msgs):
            who = "agent/bot" if (m.get("sender") or {}).get("sender_type") == "app" else "人"
            t = _msg_text(m)
            if t:
                lines.append(f"[{who}] {t}")
        reply = _run_codex(lines, trigger)
        if reply:
            send_to_group(chat, reply)
    finally:
        with _LOCK:
            _running.discard(chat)


def _sync_chats():
    """刷新群列表 + 在总机上(重新)登记。"""
    global _chats
    new = list(_FIXED_CHATS) if _FIXED_CHATS else discover_chats()
    if new and set(new) != set(_chats):
        _chats = new
        log(f"盯群: {_chats}")
    if _chats and tuple(sorted(_chats)) not in _registered:
        try:
            _bus("/register", {"agent_id": AGENT_ID, "chats": _chats})
            _registered.add(tuple(sorted(_chats)))
            log("已登记总机")
        except Exception as e:
            log(f"登记失败: {e}")


def wake_loop():
    while True:
        try:
            res = _bus(f"/poll?agent={AGENT_ID}")
        except Exception:
            time.sleep(3); continue
        for w in res.get("wakes", []):
            threading.Thread(target=maybe_respond,
                             args=(w.get("chat_id", ""), f"群里「{w.get('from','someone')}」刚说:{w.get('text','')}"),
                             daemon=True).start()
        time.sleep(3)


def detect_loop():
    seen, last_disc = {}, 0.0
    while True:
        if time.time() - last_disc > DISCOVER_EVERY:
            _sync_chats(); last_disc = time.time()
        for chat in list(_chats):
            msgs = _fetch_history(chat)
            if msgs is None:
                continue
            if chat not in seen:
                seen[chat] = {m.get("message_id") for m in msgs if m.get("message_id")}
                continue
            fresh = []
            for m in reversed(msgs):
                mid = m.get("message_id")
                if not mid or mid in seen[chat]:
                    continue
                seen[chat].add(mid)
                if _is_self(m):
                    try:
                        _bus("/notify", {"chat_id": chat, "from": AGENT_ID, "text": _msg_text(m)})
                    except Exception:
                        pass
                    continue
                fresh.append(_msg_text(m))
            if fresh:
                threading.Thread(target=maybe_respond,
                                 args=(chat, f"群里有人刚说:{fresh[-1]}"), daemon=True).start()
            if len(seen[chat]) > 200:
                seen[chat] = set(list(seen[chat])[-100:])
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    log(f"codex-client 启动 BUS={BUS_URL} codex_app={CODEX_APP_ID or '(未配!)'}")
    if not (CODEX_APP_ID and CODEX_APP_SECRET):
        log("⚠️ 缺 CODEX_APP_ID/SECRET,无法以 Codex bot 身份工作")
    _sync_chats()
    if BUS_TOKEN:
        threading.Thread(target=wake_loop, daemon=True).start()
    detect_loop()

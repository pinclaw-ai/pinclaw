#!/usr/bin/env bash
# 最小授权命令:发起 device-code → 开浏览器 → 自动循环轮询 → 拿到属于你的 token。
# 给 Codex 跑:curl -fsSL .../link-codex.sh | bash    点完同意自动成功,不用说"好了"。
set -euo pipefail
API="${PINCLAW_API:-https://api.pinclaw.ai}"
_jget(){ python3 -c 'import sys,json;print((json.load(sys.stdin) or {}).get(sys.argv[1],""))' "$1"; }

S=$(curl -s -m12 --noproxy '*' -X POST "$API/api/v1/agent-bus/device/start")
DC=$(echo "$S" | _jget device_code); URL=$(echo "$S" | _jget verify_url)
IV=$(echo "$S" | _jget interval); IV=${IV:-3}
[ -z "$DC" ] && { echo "❌ 发起授权失败: $S"; exit 1; }

echo "════════════════════════════════════════════"
echo "👉 打开这个网址,登录 Pinclaw,点「同意」:"
echo "   $URL"
echo "════════════════════════════════════════════"
for o in open xdg-open wslview; do command -v "$o" >/dev/null 2>&1 && "$o" "$URL" >/dev/null 2>&1 && break; done

echo -n "→ 等你授权(自动轮询,最多 5 分钟)"
for i in $(seq 1 100); do
  sleep "$IV"; echo -n "."
  P=$(curl -s -m12 --noproxy '*' -X POST "$API/api/v1/agent-bus/device/poll" \
      -H "Content-Type: application/json" -d "{\"device_code\":\"$DC\"}" 2>/dev/null) || P=""
  case "$(echo "$P" | _jget status)" in
    approved) echo; echo "✅ 授权成功!你的 token:"; echo "$P" | _jget token; exit 0;;
    expired)  echo; echo "❌ 超时失效,重跑这条命令即可。"; exit 1;;
  esac
done
echo; echo "❌ 5 分钟没等到授权,重跑即可。"; exit 1

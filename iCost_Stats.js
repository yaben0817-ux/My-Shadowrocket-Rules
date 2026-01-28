/**
 * iCost AI - 统计修正版（可同时用于 http-request / http-response）
 * 修复点：
 * 1) 计时按 $request.id 隔离存储，避免并发/连续请求覆盖导致耗时乱跳
 * 2) “生成记录”按本次响应 contentJson.results.length 统计（兼容 ```json code block```）
 * 3) 保留历史统计：请求次数、平均耗时、累计records、累计tokens（按平台+模型分组）
 */

const STORE_PREFIX_REQ = "iCost_req_";          // iCost_req_<request.id> -> { t, model, platform }
const STORE_KEY_STATS = "iCost_History_Data";  // 历史统计

// ========== 参数解析 ==========
function parseArgs(argStr) {
  const out = {};
  if (!argStr) return out;
  // Surge 的 $argument 是字符串，例如 "phase=request&log_level=info"
  argStr.split("&").forEach((kv) => {
    const idx = kv.indexOf("=");
    if (idx === -1) return;
    const k = decodeURIComponent(kv.slice(0, idx)).trim();
    const v = decodeURIComponent(kv.slice(idx + 1)).trim();
    if (k) out[k] = v;
  });
  return out;
}

const args = parseArgs(typeof $argument === "string" ? $argument : "");
const PHASE = args.phase || "response"; // request | response
const LOG_LEVEL = (args.log_level || "info").toLowerCase(); // info | debug

function logInfo(...a) {
  if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") console.log("[iCost]", ...a);
}
function logDebug(...a) {
  if (LOG_LEVEL === "debug") console.log("[iCost][debug]", ...a);
}

// ========== 平台识别 ==========
function getPlatform(url) {
  if (!url) return "Unknown";
  if (url.includes("api.deepseek.com")) return "DeepSeek";
  if (url.includes("api.siliconflow.cn")) return "SiliconFlow";
  if (url.includes("ark.cn-beijing.volces.com")) return "火山引擎";
  if (url.includes("openrouter.ai")) return "OpenRouter";
  if (url.includes("api.moonshot.cn")) return "Moonshot";
  if (url.includes("generativelanguage.googleapis.com")) return "Google";
  return "Unknown";
}

// ========== 解析：请求body里的 model ==========
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

function getRequestModel(requestBody) {
  if (!requestBody) return "Unknown";
  const obj = safeJsonParse(requestBody);
  if (!obj || typeof obj !== "object") return "Unknown";
  // OpenAI兼容：model 字段
  if (typeof obj.model === "string" && obj.model.trim()) return obj.model.trim();
  return "Unknown";
}

// ========== 解析：content里的 JSON（兼容 ```json ...```） ==========
function extractJsonTextFromContent(content) {
  if (!content || typeof content !== "string") return null;
  let s = content.trim();

  // 尝试去掉 Markdown code block
  // ```json\n{...}\n```
  // ```\n{...}\n```
  if (s.startsWith("```")) {
    // 找第一行结束
    const firstNewline = s.indexOf("\n");
    if (firstNewline !== -1) {
      // 去掉第一行 ```json
      s = s.slice(firstNewline + 1);
    }
    // 去掉末尾 ```
    if (s.endsWith("```")) {
      s = s.slice(0, -3);
    }
    // 再trim一次
    s = s.trim();
  }

  // 有些会包一层多余的文本，保守一点：必须以 { 或 [ 开头
  if (!(s.startsWith("{") || s.startsWith("["))) return null;
  return s;
}

function getResultCountFromResponse(respObj) {
  // respObj: OpenAI compatible response JSON
  try {
    const content = respObj?.choices?.[0]?.message?.content;
    const jsonText = extractJsonTextFromContent(content);
    if (!jsonText) return 0;

    const contentObj = safeJsonParse(jsonText);
    if (!contentObj || typeof contentObj !== "object") return 0;

    const results = contentObj.results;
    if (Array.isArray(results)) return results.length;

    return 0;
  } catch (e) {
    return 0;
  }
}

// ========== 解析：usage token ==========
function getUsage(respObj) {
  const u = respObj?.usage;
  if (!u || typeof u !== "object") return { prompt: 0, completion: 0, total: 0, has: false };

  const prompt = Number(u.prompt_tokens || 0);
  const completion = Number(u.completion_tokens || 0);
  const total = Number(u.total_tokens || (prompt + completion) || 0);
  const has = Number.isFinite(prompt) || Number.isFinite(completion) || Number.isFinite(total);

  return {
    prompt: Number.isFinite(prompt) ? prompt : 0,
    completion: Number.isFinite(completion) ? completion : 0,
    total: Number.isFinite(total) ? total : 0,
    has
  };
}

// ========== 历史统计 ==========
function readStats() {
  const raw = $persistentStore.read(STORE_KEY_STATS);
  if (!raw) return { version: 1, byKey: {} };
  const obj = safeJsonParse(raw);
  if (!obj || typeof obj !== "object") return { version: 1, byKey: {} };
  if (!obj.byKey || typeof obj.byKey !== "object") obj.byKey = {};
  return obj;
}

function writeStats(stats) {
  $persistentStore.write(JSON.stringify(stats), STORE_KEY_STATS);
}

function makeKey(platform, model) {
  return `${platform}::${model}`;
}

function updateStats(platform, model, durationMs, resultCount, usageTotalTokens) {
  const stats = readStats();
  const key = makeKey(platform, model);

  if (!stats.byKey[key]) {
    stats.byKey[key] = {
      platform,
      model,
      req_count: 0,
      total_ms: 0,
      avg_ms: 0,
      total_records: 0,
      total_tokens: 0,
      updated_at: 0
    };
  }

  const item = stats.byKey[key];
  item.req_count += 1;

  if (Number.isFinite(durationMs) && durationMs >= 0) {
    item.total_ms += durationMs;
    item.avg_ms = item.total_ms / item.req_count;
  }

  if (Number.isFinite(resultCount) && resultCount > 0) {
    item.total_records += resultCount;
  }

  if (Number.isFinite(usageTotalTokens) && usageTotalTokens > 0) {
    item.total_tokens += usageTotalTokens;
  }

  item.updated_at = Date.now();
  writeStats(stats);
  return item;
}

// ========== 工具：格式化 ==========
function msToSecText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "未知";
  return (ms / 1000).toFixed(2) + "s";
}
function num(n) {
  return Number.isFinite(n) ? n : 0;
}

// ========== 主流程 ==========
(async () => {
  try {
    const url = $request?.url || "";
    const platform = getPlatform(url);

    if (PHASE === "request") {
      const start = Date.now();
      const model = getRequestModel($request?.body || "");

      const key = STORE_PREFIX_REQ + ($request?.id || "");
      if (!($request?.id)) {
        // 极端情况：没有 request.id，那就退化为写入一个时间戳（仍然可能不准，但至少不崩）
        $persistentStore.write(JSON.stringify({ t: start, model, platform, url }), STORE_PREFIX_REQ + "NO_ID");
        logInfo("request.id 缺失，已降级写入 NO_ID", platform, model);
      } else {
        $persistentStore.write(JSON.stringify({ t: start, model, platform, url }), key);
        logDebug("已记录开始时间", { key, platform, model });
      }

      $done({});
      return;
    }

    // response phase
    const respBody = $response?.body || "";
    const respObj = safeJsonParse(respBody);

    let model = "Unknown";
    let startTime = null;
    let storedPlatform = platform;

    // 读取 request 阶段存的数据（按 request.id）
    const reqId = $request?.id || "";
    const storeKey = STORE_PREFIX_REQ + (reqId || "NO_ID");
    const storedRaw = $persistentStore.read(storeKey);

    if (storedRaw) {
      const stored = safeJsonParse(storedRaw);
      if (stored && typeof stored === "object") {
        startTime = stored.t;
        if (typeof stored.model === "string" && stored.model) model = stored.model;
        if (typeof stored.platform === "string" && stored.platform) storedPlatform = stored.platform;
      }
      // 清理，避免堆积（写空字符串）
      $persistentStore.write("", storeKey);
    }

    // 如果 request 阶段没拿到 model，尝试从响应拿
    if (model === "Unknown" && typeof respObj?.model === "string" && respObj.model.trim()) {
      model = respObj.model.trim();
    }

    const durationMs = (Number.isFinite(startTime) ? (Date.now() - startTime) : -1);

    const usage = getUsage(respObj);
    const resultCount = respObj ? getResultCountFromResponse(respObj) : 0;

    // 写入历史统计（按平台+模型）
    const statsItem = updateStats(storedPlatform, model, durationMs, resultCount, usage.total);

    // 通知内容
    const title = `iCost AI | ${storedPlatform}`;
    const lines = [];

    lines.push(`模型: ${model}`);
    lines.push(`耗时: ${msToSecText(durationMs)}`);

    // “生成记录”严格指本次 results 条数
    lines.push(`生成记录: ${resultCount}`);

    if (usage.has) {
      lines.push(`Tokens: ${num(usage.total)} (P${num(usage.prompt)}/C${num(usage.completion)})`);
    }

    // 历史统计展示（别再拿它冒充“生成记录”了）
    lines.push("");
    lines.push(`历史请求: ${statsItem.req_count} 次`);
    lines.push(`历史平均耗时: ${msToSecText(statsItem.avg_ms)}`);
    lines.push(`历史累计记录: ${statsItem.total_records} 条`);
    if (statsItem.total_tokens > 0) {
      lines.push(`历史累计Tokens: ${statsItem.total_tokens}`);
    }

    const body = lines.join("\n");

    // 如果响应无法解析，避免发一堆假数据（但耗时仍可显示）
    if (!respObj) {
      logInfo("响应JSON解析失败，仍发送基础通知", storedPlatform, model);
    }

    $notification.post(title, "", body);

    $done({});
  } catch (e) {
    console.log("[iCost][error]", e && e.message ? e.message : e);
    $done({});
  }
})();

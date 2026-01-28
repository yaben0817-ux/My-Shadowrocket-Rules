/**
 * iCost AI - 统计脚本（精简通知版）
 * - http-request：记录开始时间 & model（按 $request.id 隔离，避免并发串台）
 * - http-response：计算耗时、解析本次生成记录(results.length)、解析输入/输出tokens，并发通知
 *
 * 通知格式（固定标题）：
 * 模型: xxx
 * 耗时: 2.37s
 * 生成记录: 6  平均耗时: 0.40s
 * ⬆️In: 2715  ⬇️Out: 75
 */

const STORE_PREFIX_REQ = "iCost_req_";

// ========== 参数解析 ==========
function parseArgs(argStr) {
  const out = {};
  if (!argStr || typeof argStr !== "string") return out;
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

// ========== 工具 ==========
function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

function msToSecText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "未知";
  return (ms / 1000).toFixed(2) + "s";
}

function num(n) {
  return Number.isFinite(n) ? n : 0;
}

// ========== 平台识别（用于存储，通知标题现在固定所以不展示） ==========
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
function getRequestModel(requestBody) {
  if (!requestBody || typeof requestBody !== "string") return "Unknown";
  const obj = safeJsonParse(requestBody);
  if (!obj || typeof obj !== "object") return "Unknown";
  if (typeof obj.model === "string" && obj.model.trim()) return obj.model.trim();
  return "Unknown";
}

// ========== 解析：content里的 JSON（兼容 ```json ...```） ==========
function extractJsonTextFromContent(content) {
  if (!content || typeof content !== "string") return null;
  let s = content.trim();

  // 去掉 Markdown code block
  if (s.startsWith("```")) {
    const firstNewline = s.indexOf("\n");
    if (firstNewline !== -1) {
      s = s.slice(firstNewline + 1);
    }
    if (s.endsWith("```")) {
      s = s.slice(0, -3);
    }
    s = s.trim();
  }

  // 保守策略：必须以 { 或 [ 开头才当JSON
  if (!(s.startsWith("{") || s.startsWith("["))) return null;
  return s;
}

function getResultCountFromResponse(respObj) {
  try {
    const content = respObj?.choices?.[0]?.message?.content;
    const jsonText = extractJsonTextFromContent(content);
    if (!jsonText) return 0;

    const contentObj = safeJsonParse(jsonText);
    if (!contentObj || typeof contentObj !== "object") return 0;

    const results = contentObj.results;
    if (Array.isArray(results)) return results.length;

    return 0;
  } catch (_) {
    return 0;
  }
}

// ========== 解析：usage token ==========
function getUsage(respObj) {
  const u = respObj?.usage;
  if (!u || typeof u !== "object") return { prompt: 0, completion: 0, has: false };

  const prompt = Number(u.prompt_tokens || 0);
  const completion = Number(u.completion_tokens || 0);

  const has = Number.isFinite(prompt) || Number.isFinite(completion);
  return {
    prompt: Number.isFinite(prompt) ? prompt : 0,
    completion: Number.isFinite(completion) ? completion : 0,
    has,
  };
}

// ========== 主流程 ==========
(async () => {
  try {
    const url = $request?.url || "";
    const platform = getPlatform(url);

    // ========== request 阶段 ==========
    if (PHASE === "request") {
      const start = Date.now();
      const model = getRequestModel($request?.body || "");

      const reqId = $request?.id || "";
      const key = STORE_PREFIX_REQ + (reqId || "NO_ID");

      $persistentStore.write(
        JSON.stringify({ t: start, model, platform }),
        key
      );

      $done({});
      return;
    }

    // ========== response 阶段 ==========
    const respBody = $response?.body || "";
    const respObj = safeJsonParse(respBody);

    // 读取 request 阶段存的数据
    const reqId = $request?.id || "";
    const storeKey = STORE_PREFIX_REQ + (reqId || "NO_ID");
    const storedRaw = $persistentStore.read(storeKey);

    let startTime = null;
    let model = "Unknown";

    if (storedRaw) {
      const stored = safeJsonParse(storedRaw);
      if (stored && typeof stored === "object") {
        startTime = stored.t;
        if (typeof stored.model === "string" && stored.model) model = stored.model;
      }
      // 清理，避免堆积
      $persistentStore.write("", storeKey);
    }

    // fallback：如果 request 没拿到 model，尝试从响应拿
    if (model === "Unknown" && typeof respObj?.model === "string" && respObj.model.trim()) {
      model = respObj.model.trim();
    }

    const durationMs = (Number.isFinite(startTime) ? (Date.now() - startTime) : -1);

    const usage = getUsage(respObj);
    const resultCount = respObj ? getResultCountFromResponse(respObj) : 0;

    // 平均每条耗时
    let avgText = "-";
    if (Number.isFinite(durationMs) && durationMs >= 0 && Number.isFinite(resultCount) && resultCount > 0) {
      avgText = msToSecText(durationMs / resultCount);
    }

    // 通知（按你指定格式）
    const title = "🤖 iCost AI 服务监控";
    const lines = [];
    lines.push(`模型: ${model}`);
    lines.push(`耗时: ${msToSecText(durationMs)}`);
    lines.push(`生成记录: ${resultCount}  平均耗时: ${avgText}`);

    const inTok = usage && usage.has ? num(usage.prompt) : "-";
    const outTok = usage && usage.has ? num(usage.completion) : "-";
    lines.push(`⬆️In: ${inTok}  ⬇️Out: ${outTok}`);

    const body = lines.join("\n");
    $notification.post(title, "", body);

    $done({});
  } catch (e) {
    console.log("[iCost][error]", e && e.message ? e.message : e);
    $done({});
  }
})();

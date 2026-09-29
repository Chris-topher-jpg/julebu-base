// Keep connection failures understandable, including responses from a reverse
// proxy and requests that never finish. Mutations are never retried here.
export async function requestJson(url, options = {}, { timeout = 15000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const mutation = options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase());
  const uncertain = '提交结果暂未确认，请先刷新记录核对后再操作';
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    try {
      response = await fetchImpl(url, { ...options, signal: controller.signal });
    } catch {
      throw new Error(controller.signal.aborted
        ? `请求超时，${mutation ? uncertain : '请检查网络后重试'}`
        : `无法连接俱乐部服务，${mutation ? uncertain : '请检查网络后重试'}`);
    }
    let result;
    try { result = await response.json(); }
    catch {
      if (controller.signal.aborted) throw new Error(`请求超时，${mutation ? uncertain : '请检查网络后重试'}`);
    }
    if (!response.ok) {
      const fallback = response.status === 401 ? '登录已失效，请重新登录'
        : response.status === 403 ? '你没有执行此操作的权限'
        : response.status === 429 ? '操作过于频繁，请稍后再试'
        : response.status >= 500 ? '俱乐部服务暂时不可用，请稍后重试'
        : '操作失败，请重试';
      throw Object.assign(new Error(typeof result?.error === 'string' && result.error ? result.error : fallback), { status: response.status });
    }
    if (!result || typeof result !== 'object') {
      throw new Error(`服务返回了异常数据，${mutation ? uncertain : '请稍后重试'}`);
    }
    return result;
  } finally { clearTimeout(timer); }
}

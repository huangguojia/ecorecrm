/**
 * 领域层「可预期的失败」错误。
 *
 * 背景：服务层过去一律 `throw new Error("xxx 不存在")`，全局错误中间件只认 4xx 的
 * `error.status`，于是「传了一个已被删掉的 id」也变成 500「服务器处理请求失败」。
 * 用户和前端都无法区分「对象没了」和「服务挂了」，日志里也全是无意义的 500。
 *
 * 这里用带 status 的错误把结果显式化：中间件直接回 404，前端能提示「已被删除」。
 */
export class ResourceNotFoundError extends Error {
  readonly status = 404;
  readonly code = "RESOURCE_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

export function notFound(message: string): ResourceNotFoundError {
  return new ResourceNotFoundError(message);
}

# 官网询盘安全入口

CRM 提供 `POST /api/website-leads` 作为官网专用、只创建线索的机器接口。它不接受 CRM 用户密码或登录 JWT，而使用 HMAC-SHA256 一次性请求签名。

必需环境变量：

```dotenv
GOODJOB_WEBSITE_LEADS_KEY_ID=goodjob-website-v1
GOODJOB_WEBSITE_LEADS_SECRET=<openssl rand -base64 64 生成的密钥>
GOODJOB_WEBSITE_LEADS_OWNER_ID=<拥有 lead.create 权限的 active 用户 ID>
```

轮换时可短期配置：

```dotenv
GOODJOB_WEBSITE_LEADS_PREVIOUS_KEY_ID=goodjob-website-v0
GOODJOB_WEBSITE_LEADS_PREVIOUS_SECRET=<旧密钥>
```

签名规范：

```text
v1
<key-id>
POST
/api/website-leads
<unix-seconds>
<base64url-nonce>
<sha256-body-hex>
```

用共享密钥对上述 UTF-8 字符串计算 HMAC-SHA256 hex，并发送：

```text
X-GoodJob-Key-Id: <key-id>
X-GoodJob-Timestamp: <unix-seconds>
X-GoodJob-Nonce: <随机 nonce>
X-GoodJob-Signature: v1=<hmac hex>
```

CRM 仅接受 5 分钟窗口内的新 nonce，拒绝正文篡改、过期签名和重放请求。共享密钥不随网络请求发送。生产环境必须同时使用 HTTPS、时间同步、反向代理日志头脱敏和来源 IP 白名单。

nonce 防重放缓存当前位于 CRM API 进程内存。项目当前生产约束为单 API 实例；若未来横向运行多个 API 实例，必须先把 nonce 原子占用迁移到共享 Redis/MySQL（带 5 分钟 TTL），否则同一请求可能被重放到另一实例。

验证：

```bash
cd backend
npm run build
npm run test:website-leads-hmac
```

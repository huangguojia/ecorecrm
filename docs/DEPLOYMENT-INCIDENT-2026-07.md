# 2026-07 宝塔部署复盘与升级方案

这份记录对应本次 CRM 与 Communication 在阿里云宝塔纯终端部署中遇到的
问题。它描述的是已经写入安装脚本的防护，不是要求运维人员再次手工试错。

## 事故与根因

| 现象 | 根因 | 现在的脚本处理 |
| --- | --- | --- |
| npm ci 找不到 lockfile | npm --prefix 参数顺序错误，或上传包漏了 lockfile | 构建包强制包含两个 lockfile；安装前核验包名和清单；统一使用 npm --prefix DIR ci |
| MariaDB ERROR 1901 | MySQL 8 生成列语法被 MariaDB 10 拒绝 | 预检和安装阶段均阻止 MariaDB，要求 MySQL 8.0+ |
| root 登录 ERROR 1045 | 在 shell 里直接输入 SQL，或 root 密码/socket 不匹配 | 只接受配置文件/受支持的 socket 认证；连接失败在复制发布文件前提前失败 |
| 数据库名被当作命令 | SQL 没有通过 mysql 客户端执行 | 文档明确使用 mysql -e，安装器不执行裸 SQL |
| awk: for (index=...) | 老 awk 把 index 视为内置函数 | 统一使用 field_no，打包静态检查禁止旧写法 |
| DATABASE_CLIENT 配置错误 | 旧版强制独立 PostgreSQL，增加部署复杂度 | 新版强制 DATABASE_CLIENT=mysql 并与 CRM 共库；旧 PostgreSQL 只在迁移窗口读取 |
| 找不到 /etc/nginx/nginx.conf | 宝塔使用独立 Nginx 路径 | 优先固定 /www/server/nginx/sbin/nginx，并检查运行时 nginx -T |
| ProtectKernelLogs 不兼容 | 服务器 systemd 版本较旧 | 服务单元不再写入该指令，安装前运行 systemd-analyze verify |
| EADDRINUSE :4188 | 旧服务或残留进程未停止 | 预检识别端口归属；安装阶段先停旧服务并在失败时恢复 |
| 403 Forbidden | Nginx 无法穿过发布目录或读取静态文件 | 安装后修正目录/文件权限，并用 namei 和公开页面验收 |
| 403/500 或打开 CRM 主界面 | 宝塔旧 rewrite 抢先处理 /whatsapp-plugin/ | 写入独立 alias、资源、API 和 WebSocket 路由，并核验运行时配置 |
| index.htmlindex.php | 旧 PHP 回退规则拼接错误 | 安装前阻止旧规则，验收 Communication 独立标题和资源 |
| 不允许的请求源 | WEB_ORIGIN/CORS_ORIGINS 与域名或 HTTPS 不一致 | 按站点 SSL 自动生成并逐项核验，避免手改 .env |
| 域名 .com/.top 写错 | DOMAIN 与宝塔 server_name 不一致 | 校验纯小写域名、站点绑定、DNS 和协议 |
| 首页验收退出码 141 | 大页面经 grep -q 管道时上游收到 SIGPIPE | 下载到临时文件后再匹配 |

## 下次升级

当前统一使用 Docker Compose + 宝塔 Nginx。新包上传并解压后，在包根目录执行：

    ./update-registry.sh 新版本号

脚本会自动保留 `/opt/goodjobcrm/shared` 中的配置、密钥和数据卷，备份 MySQL、
上传文件与 Communication 媒体，拉取三个固定版本镜像，执行幂等迁移，启动应用并
进行健康检查。失败时尝试恢复上一版应用容器；业务数据库不会自动回滚。

服务器端使用公开镜像，不需要执行 `docker login`。宝塔只负责域名、SSL 和 Nginx
反向代理，不能使用旧的宿主机 Node.js/systemd 部署入口。

## 上传完整性

打包脚本会生成 PACKAGE-MANIFEST.sha256 和压缩包旁的 .sha256。安装器会在
复制任何发布文件前校验包内每一个文件，避免只上传压缩包但漏传 lockfile、许可证
或构建产物。

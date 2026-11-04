# GoodJob CRM 开发、镜像发布与服务器部署更新手册

> 适用范围：GoodJob CRM 私人版源码、阿里云 ACR 固定版本镜像、宝塔 Linux 服务器。
> 本手册以 `1.5.13` 为示例。以后发布时，把命令中的版本号统一替换为新版本号。

## 1. 先记住完整流程

一次完整发布分为四段：

1. 在开发电脑修改代码并自测。
2. 更新界面版本号，安全检查后提交私人 SVN。
3. 在开发电脑构建三个 `linux/amd64` 镜像并推送到阿里云 ACR。
4. 在服务器运行 `./update-registry.sh 新版本号`，自动备份、拉镜像、迁移数据库并启动。

服务器**不需要拉取源码，也不需要安装 Node.js**。服务器只需要 Docker、部署脚本包和
ACR 登录凭据。源码编译全部在开发电脑完成。

当前固定信息：

```text
私人源码目录：/Users/sendohakria/Desktop/GoodJob_private
私人 SVN：svn://gitee.com/sendoh-huang/good-job-private
镜像地域：中国香港
镜像架构：linux/amd64
后端镜像：crpi-f1g4pi9vyexdaer5.cn-hongkong.personal.cr.aliyuncs.com/kevin_goodjobcrm/backend
通信镜像：crpi-f1g4pi9vyexdaer5.cn-hongkong.personal.cr.aliyuncs.com/kevin_goodjobcrm/communication
网关镜像：crpi-f1g4pi9vyexdaer5.cn-hongkong.personal.cr.aliyuncs.com/kevin_goodjobcrm/gateway
生产域名：www.youwilldoagoodjob.top
服务器持久目录：/opt/goodjobcrm/shared
服务器本机入口：http://127.0.0.1:4188
```

## 2. 数据和代码边界

以下内容可以进入 SVN 和镜像：

- 前后端源码；
- 数据库结构和增量迁移代码；
- 不含业务数据的公共模板；
- Dockerfile、Compose 和部署脚本；
- 产品版本配置。

以下内容绝不能提交，也不能放进镜像：

- `.env.personal.local`、任何生产 `.env`；
- 个人业务数据库、SQL 导出、数据库备份；
- `backend/uploads` 中的客户文件、Logo、公章和签名；
- 40 个管理员的明文账号密码清单；
- `/opt/goodjobcrm/shared/secrets`；
- `node_modules`、`dist-packages`、测试报告和临时构建文件。

镜像内只有程序和公共资源。生产数据库、上传文件和密钥保存在服务器 Docker 数据卷与
`/opt/goodjobcrm/shared`，更新镜像不会覆盖这些数据。

## 3. 新开发电脑首次准备

### 3.1 推荐环境

- macOS；
- Docker Desktop；
- Subversion；
- 可选：Node.js 22，用于本地运行和测试。只构建镜像时可以不在宿主机安装 Node.js；
- 至少 20 GiB 可用磁盘。

### 3.2 安装并检查工具

Mac 先安装 Docker Desktop 并启动，确认顶部状态显示 Docker 正在运行。然后执行：

```bash
docker --version
docker compose version
docker buildx version
docker info
```

如果 `docker info` 报无法连接 daemon，说明 Docker Desktop 尚未启动完成。

安装 macOS 命令行工具和 SVN：

```bash
xcode-select --install
svn --version
```

需要在宿主机本地运行项目和测试时，安装 Node.js 22。安装后检查：

```bash
node --version
npm --version
```

### 3.3 检出私人仓库

```bash
cd ~/Desktop
svn checkout svn://gitee.com/sendoh-huang/good-job-private GoodJob_private
cd ~/Desktop/GoodJob_private
svn info
```

SVN 身份认证应使用 Gitee 的**用户名/账号标识**和适用于 SVN 的密码或访问凭据，不要把
“手机号登录”直接等同于 SVN 用户名。出现 `E210007` 或 `Incorrect username or password`
时，先在 Gitee 网页确认账号标识和凭据；镜像部署服务器本身不需要 SVN，所以不要为了
部署在生产服务器反复尝试拉源码。

### 3.4 安装依赖的含义

“安装依赖”不是安装业务数据，而是根据 `package-lock.json` 下载编译程序所需的 Node.js
库。首次安装、依赖版本变化或更换电脑时需要执行：

```bash
cd ~/Desktop/GoodJob_private
npm ci --no-audit --no-fund
npm --prefix whatsapp-plugin ci --no-audit --no-fund
```

如果只需要发布镜像，可以直接运行后面的 `publish-images.sh`。脚本会在临时 Node.js 22
容器中执行 `npm ci` 和生产构建，宿主机不必安装 Node.js 依赖。

## 4. 每次修改和发布新版本

下面以从 `1.5.13` 发布 `1.5.14` 为例。

### 4.1 开始修改前同步 SVN

```bash
cd /Users/sendohakria/Desktop/GoodJob_private
svn status
svn update
```

如果 `svn status` 已经显示本地修改，先确认这些修改是谁做的，不要直接覆盖或还原。

### 4.2 修改代码

只在私人版源码目录修改。当前项目采用一套主代码维护；公开版发布时再按发布规则移除
不公开功能，不要长期维护多套本地副本。

修改完成后先看变更：

```bash
svn status
svn diff --summarize
svn diff
```

### 4.3 修改登录界面产品版本

编辑文件：

```text
frontend/public/product-config.json
```

例如：

```json
{
  "productName": "GoodJob CRM",
  "version": "1.5.14"
}
```

检查版本：

```bash
cat frontend/public/product-config.json
```

以后提出“提交 SVN，版本 1.5.14”时，应同时更新此文件，再构建和提交。

### 4.4 自测和生产构建

有 Node.js 22 和依赖时，执行：

```bash
npm run build
npm test
```

若完整测试时间较长，至少完成与修改功能有关的专项测试和生产构建。无需本地 Node.js 的
生产构建命令是：

```bash
./deploy/docker-compose/build-in-docker.sh
```

它会在临时 Node.js 22 Docker 容器中安装锁定依赖并构建 Backend、Frontend、
Integration Worker、Runner 和 Communication。

### 4.5 提交前数据库安全检查

```bash
npm run svn:check-database
svn status --no-ignore
```

不保存个人运行数据的纯源码工作副本中，安全检查应显示：

```text
SVN 数据库安全检查通过：未发现个人配置、数据库备份或私有运行数据
```

当前电脑若本来就在使用个人业务环境，检查可能主动列出 `.env.personal.local`、
`backend/uploads`、`dist-packages`。这是防误提交保护，不是构建错误，也不要为了让检查
变绿而误删个人数据。此时必须检查 `svn status`，并像第4.6节一样只提交明确的源码路径；
禁止对整个工作副本执行无差别提交。

重点人工确认没有以下路径：

```text
.env.personal.local
backend/uploads
dist-packages
*.sql
*.sql.gz
*.dump
beta-admin-credentials.txt
```

不要使用 `svn add --force .`。新文件应明确逐个加入：

```bash
svn add backend/src/新文件.ts frontend/src/新文件.ts
```

### 4.6 提交私人 SVN

建议只提交明确的源码文件，不把整个目录盲目提交：

```bash
svn commit \
  frontend/public/product-config.json \
  backend/src/需要提交的文件.ts \
  frontend/src/需要提交的文件.ts \
  -m "1.5.14版本，功能说明"
```

如果变更文件较多，先确保 `svn status` 只有允许提交的源码和配置，再执行：

```bash
svn commit -m "1.5.14版本，功能说明"
```

提交后验证远端，而不是只看工作区是否干净：

```bash
svn log -r HEAD -v svn://gitee.com/sendoh-huang/good-job-private
svn cat svn://gitee.com/sendoh-huang/good-job-private/frontend/public/product-config.json
```

注意：混合修订工作副本中，直接执行 `svn log -l 3` 可能停留在目录自身的旧修订号。
使用 `svn log -r HEAD` 才能明确查看远端最新修订。

## 5. 构建并推送阿里云镜像

### 5.1 登录 ACR

在开发电脑执行：

```bash
docker login crpi-f1g4pi9vyexdaer5.cn-hongkong.personal.cr.aliyuncs.com
```

用户名和密码从阿里云“容器镜像服务 ACR -> 实例 -> 访问凭证”获取。密码只在终端输入，
不要写入源码、文档或 `.env`。

### 5.2 发布固定版本镜像

```bash
cd /Users/sendohakria/Desktop/GoodJob_private
./publish-images.sh 1.5.14
```

脚本会：

1. 在临时 Node.js 22 容器中重新安装锁定依赖并生产构建；
2. 构建 `linux/amd64` backend 镜像；
3. 构建 `linux/amd64` communication 镜像；
4. 构建 `linux/amd64` gateway 镜像；
5. 依次推送三个固定版本标签到香港 ACR。

最后必须看到：

```text
[GoodJob 镜像发布] 三个 linux/amd64 镜像已推送完成：1.5.14
```

backend 包含 LibreOffice 和中文字体，体积约数百 MB，第一次上传可能较慢。只要
`docker buildx build ... --push` 进程仍在运行，就不要重复启动第二次发布。

### 5.3 验证远端镜像

```bash
REGISTRY=crpi-f1g4pi9vyexdaer5.cn-hongkong.personal.cr.aliyuncs.com/kevin_goodjobcrm

docker buildx imagetools inspect "$REGISTRY/backend:1.5.14"
docker buildx imagetools inspect "$REGISTRY/communication:1.5.14"
docker buildx imagetools inspect "$REGISTRY/gateway:1.5.14"
```

进一步确认服务器架构：

```bash
docker pull --platform linux/amd64 "$REGISTRY/backend:1.5.14"
docker image inspect "$REGISTRY/backend:1.5.14" \
  --format 'arch={{.Architecture}} os={{.Os}} id={{.Id}}'
```

预期为：

```text
arch=amd64 os=linux
```

不要只推 `latest`。固定版本号用于准确升级、审计和回滚；只有重新构建并推送新标签后，
服务器才会得到新代码。

## 6. 生成新服务器首次安装包

服务器不需要源码，只需要部署脚本包。开发电脑执行：

```bash
cd /Users/sendohakria/Desktop/GoodJob_private
./deploy/docker-compose/build-registry-package.sh 1.5.14
```

生成：

```text
dist-packages/GoodJob-CRM-Registry-1.5.14.tar.gz
dist-packages/GoodJob-CRM-Registry-1.5.14.tar.gz.sha256
```

该包只有 Compose 和运维脚本，不包含源码、数据库、上传文件和密钥。

什么时候需要重新上传部署脚本包：

- 新服务器首次安装：必须上传；
- 只修改业务前后端代码：通常不用，服务器直接更新镜像；
- 修改了 `deploy/docker-compose`、镜像地址、资源限制、迁移流程或 Nginx 配置：应上传
  新部署脚本包，再执行更新。

## 7. 新 Linux 服务器首次安装

### 7.1 推荐服务器规格

正式环境推荐：

- x86_64/amd64；
- 4 核 CPU；
- 至少 4 GiB 内存，推荐 8 GiB；
- 至少 40 GiB SSD；
- 2-4 GiB Swap；
- Alibaba Cloud Linux 3、Rocky Linux、CentOS Stream 或 Ubuntu LTS。

2 GiB 服务器只能用于短期测试。它能运行不代表适合多人长期使用。

检查：

```bash
cat /etc/os-release
uname -m
free -h
swapon --show
df -h
```

`x86_64` 对应镜像平台 `linux/amd64`。

### 7.2 先处理服务器安全

若登录时显示大量 SSH 失败尝试，应优先：

- 修改 root 密码；
- 使用 SSH 密钥；
- 在阿里云安全组只开放 `22`、`80`、`443`，数据库端口不要公网开放；
- 更新系统安全补丁；
- 条件允许时关闭 root 密码登录并使用普通运维账号提权。

不要对外开放 `3306`、`5432`、`3100` 或 `4188`。GoodJob 的 `4188` 只监听
`127.0.0.1`，公网由宝塔 Nginx 转发。

### 7.3 安装 Docker（Alibaba Cloud Linux 3）

```bash
dnf install -y dnf-plugins-core
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
```

验证：

```bash
docker --version
docker compose version
systemctl is-active docker
```

预期最后一项为 `active`。

### 7.4 检查或增加 Swap

先检查，宝塔可能已经创建 `/www/swap`：

```bash
free -h
swapon --show
```

已有 Swap 时不要重复创建。没有 Swap 时，示例创建 4 GiB：

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
swapon --show
```

### 7.5 上传并校验部署包

把 `.tar.gz` 和 `.sha256` 上传到服务器 `/root`，然后：

```bash
cd /root
sha256sum -c GoodJob-CRM-Registry-1.5.14.tar.gz.sha256
tar -xzf GoodJob-CRM-Registry-1.5.14.tar.gz
cd /root/GoodJob-CRM-Registry-1.5.14
chmod +x *.sh deploy/docker-compose/*.sh
```

`sha256sum` 必须显示 `OK`。macOS 打包的压缩文件解压时若出现：

```text
Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'
```

这是 macOS 扩展属性警告，不影响文件内容；只要校验通过且文件完整，可继续。

### 7.6 登录服务器端 ACR

```bash
docker login crpi-f1g4pi9vyexdaer5.cn-hongkong.personal.cr.aliyuncs.com
```

服务器只拉镜像，不拉 SVN 源码。

### 7.7 配置域名 DNS

在域名服务商增加 A 记录：

```text
主机记录：www
记录类型：A
记录值：服务器公网 IP
```

服务器检查：

```bash
getent hosts www.youwilldoagoodjob.top
```

返回 IP 必须是当前服务器公网 IP。

### 7.8 执行首次配置

```bash
cd /root/GoodJob-CRM-Registry-1.5.14
./configure.sh
```

依次输入：

1. 域名，不含 `http://` 或 `https://`；
2. 当前是否已经启用 HTTPS；
3. 首个超级管理员邮箱；
4. 首个超级管理员姓名；
5. 至少 8 位的初始密码；使用短口令时应在首次登录后立即修改。

配置生成在：

```text
/opt/goodjobcrm/shared/deploy.env
/opt/goodjobcrm/shared/secrets/
```

`configure.sh` 为防止覆盖生产密钥，不允许在 `/opt/goodjobcrm` 已存在时重复执行。已有
配置时不要删除目录重来，应修正现有配置或从备份恢复。

检查权限：

```bash
stat -c '%U:%G %a %n' /opt/goodjobcrm/shared/secrets/*
```

当前容器使用 Node 官方镜像的 UID/GID 1000。若密钥误变成其他组且容器提示无权读取，
修复为：

```bash
chown root:1000 /opt/goodjobcrm/shared/secrets/*
chmod 640 /opt/goodjobcrm/shared/secrets/*
```

### 7.9 低内存测试服务器的特殊配置

正式服务器不要跳过内存预检。只有明确接受性能和 OOM 风险的测试服务器才设置：

```bash
vi /opt/goodjobcrm/shared/deploy.env
```

加入：

```ini
GOODJOB_ALLOW_LOW_MEMORY=true
```

如果没有 `nano`，使用 `vi`；也可以安装：

```bash
dnf install -y nano
```

若 MySQL 因容器自身内存限制触发 `memcg OOM`，单纯增加宿主机 Swap 可能仍不够。先查：

```bash
journalctl -k --since "30 minutes ago" | grep -iE 'out of memory|oom|killed process' | tail -50
docker inspect goodjobcrm-mysql-1 --format 'OOM={{.State.OOMKilled}} Exit={{.State.ExitCode}}'
```

确认被杀进程是 `mysqld` 后，可在 `deploy.env` 将 MySQL 限制调整为：

```ini
MYSQL_MEMORY_LIMIT=896m
```

同时保证至少 2-4 GiB Swap，并观察 `free -h`。不要在不了解原因时反复重装或删除卷。

### 7.10 预检并首次启动

```bash
cd /root/GoodJob-CRM-Registry-1.5.14
./preflight.sh
./update-registry.sh 1.5.14
```

`update-registry.sh` 会自动执行：

1. 预检；
2. 拉取三个固定版本镜像；
3. 启动统一 MySQL；
4. 执行幂等数据库迁移；
5. 启动 Communication、Backend 和 Gateway；
6. 检查健康状态。

验证：

```bash
curl -fsS http://127.0.0.1:4188/api/health
docker ps --filter label=com.docker.compose.project=goodjobcrm
```

健康响应示例：

```json
{"ok":true,"store":"mysql","prospectQueue":{"mode":"mysql_polling","running":true,"degraded":false}}
```

首次启动时健康检查可能短暂出现 `curl: (7) Failed to connect`，随后变为健康属于正常启动
过程。持续失败才需要查看日志。

## 8. 宝塔反向代理和 HTTPS

### 8.1 为什么需要宝塔网站和反向代理

Docker 网关只监听服务器本机 `127.0.0.1:4188`，这样应用端口不会直接暴露到公网。
宝塔 Nginx 接收域名的 `80/443` 请求，再转发到 `127.0.0.1:4188`，同时负责 SSL、
域名和 WebSocket。

### 8.2 创建网站

宝塔中进入“网站 -> 添加站点”：

- 域名：`www.youwilldoagoodjob.top`；
- 类型：纯静态即可；
- PHP：不需要；
- 数据库：不创建。

网站目录只是让宝塔生成独立 Nginx 配置，真正页面来自 Docker 网关。

### 8.3 添加反向代理

进入该网站“设置 -> 反向代理 -> 添加”：

```text
代理名称：goodjobcrm
目标 URL：http://127.0.0.1:4188
发送域名：$host
缓存：关闭
WebSocket：开启
读取超时：300 秒
```

检查并平滑重载：

```bash
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
```

`nginx -t` 失败时不要 reload，先修复配置。

服务器本机验证域名路由：

```bash
curl -s -H 'Host: www.youwilldoagoodjob.top' http://127.0.0.1/api/health
curl -I -H 'Host: www.youwilldoagoodjob.top' http://127.0.0.1/
```

如果根路径仍返回宝塔默认静态页，说明反向代理没有覆盖 `location /`；API 能通但首页仍是
默认页也不算配置完成。

### 8.4 申请 SSL 后切换 HTTPS

在宝塔网站“SSL”中申请并部署证书，开启强制 HTTPS。然后修改：

```bash
vi /opt/goodjobcrm/shared/deploy.env
```

确保：

```ini
PUBLIC_SCHEME=https
PUBLIC_ORIGIN=https://www.youwilldoagoodjob.top
SESSION_COOKIE_SECURE=true
EMAIL_TRACKING_BASE_URL=https://www.youwilldoagoodjob.top
```

重新应用配置：

```bash
cd /root/GoodJob-CRM-Registry-1.5.14
./update-registry.sh 1.5.14
```

验证：

```bash
curl -I https://www.youwilldoagoodjob.top/
curl -fsS https://www.youwilldoagoodjob.top/api/health
```

HTTPS 尚未真正生效前不要设置 `SESSION_COOKIE_SECURE=true`，否则浏览器不会在 HTTP 下
保存登录 Cookie，会表现为登录后立即掉线或反复要求登录。

## 9. 首次管理员和40个公测团队账号

### 9.1 首个超级管理员

首次配置填写的邮箱在：

```bash
grep '^INITIAL_ADMIN_EMAIL=' /opt/goodjobcrm/shared/deploy.env
```

初始密码在：

```bash
cat /opt/goodjobcrm/shared/secrets/initial_admin_password
```

该文件只允许 root 查看，不要上传或提交。

### 9.2 只在首次需要时预置40个账号

40个公测管理员分别属于40个团队，彼此数据不可见。先定义持久凭据文件：

```bash
CRED=/opt/goodjobcrm/shared/beta-admin-credentials.txt
CONTAINER=goodjobcrm-backend-1
```

如果凭据文件以前已经存在，必须先复制回容器，保证脚本继续使用原密码：

```bash
if [ -f "$CRED" ]; then
  docker cp "$CRED" "$CONTAINER:/tmp/beta-admin-credentials.txt"
fi
```

执行预置：

```bash
docker exec "$CONTAINER" \
  /usr/local/bin/goodjob-backend-entrypoint \
  node backend/dist/provision-beta-admins.js \
  --file=/tmp/beta-admin-credentials.txt
```

保存到宿主持久目录：

```bash
docker cp "$CONTAINER:/tmp/beta-admin-credentials.txt" "$CRED"
chown root:root "$CRED"
chmod 600 "$CRED"
```

查看：

```bash
less "$CRED"
```

不要只把凭据留在容器 `/tmp`，容器更新重建后文件会消失。更重要的是，若账号已存在但
凭据文件丢失，脚本重新生成的新密码不会自动覆盖数据库中原密码，最终会出现“清单里的
账号无法登录”。因此该文件必须和数据库备份一起安全保存。

直接运行 Node 脚本若报：

```text
缺少 DATABASE_URL 或 MYSQL_URL
```

说明绕过了容器入口。必须使用上面包含
`/usr/local/bin/goodjob-backend-entrypoint` 的完整命令。

### 9.3 日常更新不重建账号

执行 `./update-registry.sh 新版本` 时，用户表和团队数据都保存在 MySQL 数据卷中，40个
账号无需重新生成。只在全新空数据库首次初始化时执行预置命令。

## 10. 服务器以后如何一键更新

### 10.1 更新前确认

开发电脑必须已经完成：

```text
新版本代码已提交 SVN
三个新版本镜像已推送 ACR
三个远端标签均可 inspect
数据库变更使用增量、幂等迁移
```

服务器检查当前版本：

```bash
cat /opt/goodjobcrm/shared/state/current-release
```

检查状态：

```bash
cd /root/GoodJob-CRM-Registry-1.5.14
./manage.sh status
```

### 10.2 一条命令更新

假设更新到 `1.5.15`：

```bash
cd /root/GoodJob-CRM-Registry-1.5.14
./update-registry.sh 1.5.15
```

旧目录名是 `1.5.14` 不影响拉取 `1.5.15` 镜像，只要部署脚本本身没有变化。

更新脚本会自动：

1. 预检；
2. 对当前统一 MySQL、上传文件、Logo、公章、签名和 Communication 媒体做备份；
3. 拉取新镜像；
4. 执行可重复运行的增量迁移；
5. 启动新容器；
6. 健康检查；
7. 保留当前版和上一版镜像。

数据库和账号不会随镜像更新被清空。

### 10.3 部署脚本也变化时

把新版本 registry 安装包上传并解压，然后从新目录执行：

```bash
cd /root
sha256sum -c GoodJob-CRM-Registry-1.5.15.tar.gz.sha256
tar -xzf GoodJob-CRM-Registry-1.5.15.tar.gz
cd /root/GoodJob-CRM-Registry-1.5.15
chmod +x *.sh deploy/docker-compose/*.sh
./update-registry.sh 1.5.15
```

它会继续使用 `/opt/goodjobcrm/shared` 中原有配置、密钥和数据卷，不会重新运行
`configure.sh`。

### 10.4 更新后验收

```bash
./manage.sh status
curl -fsS http://127.0.0.1:4188/api/health
curl -fsS https://www.youwilldoagoodjob.top/api/health
cat /opt/goodjobcrm/shared/state/current-release
docker ps --filter label=com.docker.compose.project=goodjobcrm
```

浏览器还应检查：

- 登录页版本是否为新版本；
- 管理员和业务员能否登录；
- 原客户、商机、单据和上传图片是否仍在；
- 新功能是否可见；
- 不同团队数据是否仍隔离。

## 11. 日常运维命令

在当前部署包目录执行：

```bash
./manage.sh status
./manage.sh logs 200
./manage.sh restart
./manage.sh stop
./manage.sh start
```

`./manage.sh logs 200` 会持续跟随日志，按 `Ctrl+C` 退出，不会停止容器。

直接查看单个容器：

```bash
docker logs --tail 200 goodjobcrm-backend-1
docker logs --tail 200 goodjobcrm-communication-1
docker logs --tail 200 goodjobcrm-gateway-1
docker logs --tail 200 goodjobcrm-mysql-1
```

资源情况：

```bash
docker stats --no-stream
free -h
df -h
docker system df
```

**禁止执行：**

```bash
docker compose down -v
```

`-v` 会删除 GoodJob 数据卷，可能造成生产数据丢失。

## 12. 备份、回滚和恢复

### 12.1 手动备份

```bash
./backup.sh
ls -lah /opt/goodjobcrm/shared/backups
```

每次升级前脚本也会自动备份。备份包含数据库、上传文件、Communication 媒体、部署配置
和密钥，默认保留最近10份。备份等同于生产数据，应加密复制到服务器外保存。

### 12.2 应用镜像回滚

新版本应用有问题但数据库迁移正常时：

```bash
./rollback.sh
```

按提示输入上一版本号确认。该操作只切换应用镜像，不反向迁移数据库。

### 12.3 数据库恢复

只有确认数据或迁移损坏时才执行：

```bash
./restore.sh /opt/goodjobcrm/shared/backups/具体时间戳
```

恢复会覆盖 GoodJob 自己的数据库和上传卷，属于破坏性操作。执行前脚本会再次备份当前
状态并要求输入 `RESTORE-GOODJOB`。

## 13. 常见问题和本次踩坑记录

### 13.1 `preflight` 一直提示内存不足

原因：脚本读取的是 `/proc/meminfo` 的可用内存；增加 Swap 不等于物理可用内存达到
2 GiB。测试机需要在 `/opt/goodjobcrm/shared/deploy.env` 明确加入：

```ini
GOODJOB_ALLOW_LOW_MEMORY=true
```

修改后重新执行 `./preflight.sh`。不要只在另一个终端临时 `export` 后忘记当前会话。

### 13.2 内核日志显示 `mysqld` 被 OOM Kill

若出现 `constraint=CONSTRAINT_MEMCG`，表示 MySQL 撞到了容器内存限制，不一定是整台机器
完全没内存。增加 Swap 后仍可能发生。按第7.9节提高 `MYSQL_MEMORY_LIMIT`，然后重新运行
更新脚本；不要删除 MySQL 卷。

### 13.3 backend 日志只有数据库 profile，没有报错

先查容器健康详情：

```bash
docker inspect goodjobcrm-backend-1 \
  --format '状态={{.State.Status}} 运行={{.State.Running}} OOM={{.State.OOMKilled}} 退出码={{.State.ExitCode}}{{range .State.Health.Log}}{{println}}{{.End}} exit={{.ExitCode}} output={{printf "%s" .Output}}{{end}}'
```

若后续健康记录已经返回 `{"ok":true}`，早期一次 `curl: (7)` 只是启动窗口，不需要重装。

### 13.4 域名解析正确但浏览器打不开

按顺序定位：

```bash
curl -fsS http://127.0.0.1:4188/api/health
curl -s -H 'Host: www.youwilldoagoodjob.top' http://127.0.0.1/api/health
curl -I https://www.youwilldoagoodjob.top/
```

- 第一条失败：Docker 应用问题；
- 第一条成功、第二条失败：宝塔反向代理问题；
- 前两条成功、外网失败：DNS、安全组、80/443、防火墙或 SSL 问题；
- API 成功但首页是宝塔默认页：`location /` 没有代理到 4188。

### 13.5 登录提示“不允许的请求来源”

`PUBLIC_ORIGIN` 必须和浏览器地址完全一致，包括协议和 `www`：

```ini
PUBLIC_ORIGIN=https://www.youwilldoagoodjob.top
```

修改后执行：

```bash
./update-registry.sh 当前版本号
```

不要同时用 `http://`、裸域名和 `www` 混着登录。

### 13.6 HTTPS 后账号密码正确仍无法保持登录

确认：

```ini
PUBLIC_SCHEME=https
SESSION_COOKIE_SECURE=true
```

反之，在仅 HTTP 测试阶段必须是 `SESSION_COOKIE_SECURE=false`。

### 13.7 40个账号生成了但无法登录

常见原因：

- 凭据文件只留在旧容器 `/tmp`，容器重建后丢失；
- 再次运行脚本生成了新密码，但数据库中的现有账号被跳过，没有更新密码；
- 使用了旧域名或错误 `PUBLIC_ORIGIN`；
- 手动执行 Node 脚本时没有通过 entrypoint 注入数据库连接。

应恢复最初的 `beta-admin-credentials.txt`，不要继续反复生成。如果原始凭据已永久丢失，
应通过系统改密功能或受控的管理员重置流程逐个重置，而不是删除业务数据库。

### 13.8 SVN 始终认证失败

`svn://` 私人仓库认证和网页手机号登录不是一回事。确认 Gitee 账号标识和 SVN 可用凭据。
对于生产服务器，直接停止这条路径，使用 ACR 镜像部署，不需要检出源码。

### 13.9 `nano: command not found`

使用：

```bash
vi /opt/goodjobcrm/shared/deploy.env
```

或安装：

```bash
dnf install -y nano
```

### 13.10 ACR 镜像标签 `not found`

说明该版本尚未成功推送，或登录了错误实例/地域。回到开发电脑确认三个
`imagetools inspect` 都成功。不要在服务器用不存在的版本反复更新。

### 13.11 更新时数据库会不会一起被覆盖

不会。镜像不包含生产数据库，数据库在 `goodjobcrm_mysql_data` 卷中。更新前自动备份，
升级只执行增量、幂等迁移。设计新功能时应新增表、字段或索引，并保证迁移可重复执行，
不要通过删除并重建旧表来升级。

### 13.12 为什么镜像更新后页面还是旧版本

依次检查：

```bash
cat /opt/goodjobcrm/shared/state/current-release
docker ps --format 'table {{.Names}}\t{{.Image}}'
cat frontend/public/product-config.json  # 只在开发电脑检查
```

浏览器执行强制刷新。若容器镜像标签仍是旧版，说明服务器更新没有完成；若标签已更新但
登录页版本旧，说明构建镜像前没有修改 `product-config.json` 或镜像标签被错误复用。

## 14. 最短操作清单

### 14.1 每次发布

开发电脑：

```bash
cd /Users/sendohakria/Desktop/GoodJob_private
svn update
# 修改代码和 frontend/public/product-config.json
npm run build
npm run svn:check-database
svn status
# 检查通过后提交；若安全检查列出个人文件，只提交明确的源码路径
svn commit frontend/public/product-config.json 其他已确认源码文件 -m "1.5.14版本，功能说明"
docker login crpi-f1g4pi9vyexdaer5.cn-hongkong.personal.cr.aliyuncs.com
./publish-images.sh 1.5.14
```

服务器：

```bash
cd /root/GoodJob-CRM-Registry-1.5.14
./update-registry.sh 1.5.14
./manage.sh status
curl -fsS https://www.youwilldoagoodjob.top/api/health
```

### 14.2 新服务器首次安装

```text
安装 Docker -> 上传 registry 部署包 -> docker login ACR -> 配置 DNS
-> ./configure.sh -> ./preflight.sh -> ./update-registry.sh 固定版本
-> 宝塔反向代理 -> SSL -> 修改 PUBLIC_ORIGIN/COOKIE -> 验收
```

## 15. 凭据保存清单

至少安全保存以下内容：

- Gitee 私人 SVN 凭据；
- 阿里云 ACR 登录凭据；
- 服务器 SSH 私钥；
- 首个超级管理员账号和密码；
- 40个公测管理员原始凭据文件；
- `/opt/goodjobcrm/shared/secrets` 的加密离线备份；
- `/opt/goodjobcrm/shared/backups` 的异机备份；
- 域名和 SSL 证书管理账号。

任何明文凭据都不要提交到 SVN、GitHub、镜像或聊天记录中。

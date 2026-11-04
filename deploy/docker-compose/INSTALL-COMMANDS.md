# GoodJob CRM 1.7.2 可复制安装指令

真实物流查询使用 17TRACK API。首次配置时可填写 Token；留空也不影响安装，但「真实查询」需要 Token 才会返回承运商数据。承运商通常只返回扫描位置，不提供收货人的精确门牌地址。

## 一、服务器首次安装

### 1. 上传文件

以下命令在安装人员自己的电脑执行，把 `服务器公网IP` 替换成实际 IP：

```bash
scp \
  GoodJob-CRM-Registry-1.7.2.tar.gz \
  GoodJob-CRM-Registry-1.7.2.tar.gz.sha256 \
  root@服务器公网IP:/root/
```

### 2. 校验并解压

以下命令在服务器执行：

```bash
cd /root
sha256sum -c GoodJob-CRM-Registry-1.7.2.tar.gz.sha256
tar -xzf GoodJob-CRM-Registry-1.7.2.tar.gz
cd GoodJob-CRM-Registry-1.7.2
chmod +x *.sh
```

校验必须显示：

```text
GoodJob-CRM-Registry-1.7.2.tar.gz: OK
```

### 3. 配置管理员和域名

```bash
./configure.sh
```

按提示填写：

```text
域名：crm.nanmianyun.com
HTTPS：y
超级管理员邮箱：按你的部署需求填写
超级管理员姓名：GoodJob Admin
超级管理员密码：设置一个至少 12 位的强密码

安装脚本还会自动创建 50 个团队管理员，账号为：

```text
beta-admin-01@goodjob-crm.com ... beta-admin-50@goodjob-crm.com
```

随机密码会保存到服务器：

```text
/opt/goodjobcrm/shared/secrets/admin_credentials.tsv
```
```

### 4. 预检并安装

```bash
./preflight.sh
./install.sh
```

如果预检只提示可用内存不足：

```bash
export GOODJOB_ALLOW_LOW_MEMORY=true
./preflight.sh
./install.sh
```

服务器端不执行 `docker login`。本版本直接拉取公开镜像。

### 5. 检查容器和服务

```bash
./manage.sh status
docker ps --filter name=goodjobcrm \
  --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
curl -fsS http://127.0.0.1:4188/api/health
```

## 二、宝塔 Nginx 反代

先找到 `.com` 网站配置：

```bash
grep -RnlE '^[[:space:]]*server_name[[:space:]]+crm\.nanmianyun\.com([[:space:]]|;)' \
  /www/server/panel/vhost/nginx 2>/dev/null
```

修改前备份实际配置文件：

```bash
cp -a /www/server/panel/vhost/nginx/实际配置文件 \
  /root/crm.nanmianyun.com.conf.bak.$(date +%Y%m%d%H%M%S)
```

在 `crm.nanmianyun.com` 的 HTTPS `server {}` 中加入以下配置。已有 `location /` 时替换原块，不要重复添加：

```nginx
location ^~ /assets/ {
    proxy_pass http://127.0.0.1:4188;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
}

location / {
    proxy_pass http://127.0.0.1:4188;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
}
```

检查并重载：

```bash
nginx -t && systemctl reload nginx
```

### 反代验证

```bash
curl -kfsS https://127.0.0.1/api/health \
  -H 'Host: crm.nanmianyun.com'

curl -kI https://127.0.0.1/assets/index-CA-XoN24.js \
  -H 'Host: crm.nanmianyun.com'
```

两个请求分别应返回健康 JSON 和 `HTTP/2 200`。

## 三、登录

```text
地址：https://crm.nanmianyun.com
超级管理员：使用 ./configure.sh 时填写的邮箱和密码
```

查看 50 个团队管理员账号密码：

```bash
column -t -s $'\t' /opt/goodjobcrm/shared/secrets/admin_credentials.tsv
```

首次登录后立即修改密码。50 个账号分别属于 `beta-001` 到 `beta-050` 独立团队。

## 四、日常管理

```bash
cd /root/GoodJob-CRM-Registry-1.7.2
./manage.sh status
./manage.sh logs 200
./manage.sh restart
./manage.sh stop
./manage.sh start
```

备份：

```bash
./backup.sh
```

## 五、更新镜像

上传并解压新版本包后，在新版本目录执行：

```bash
cd /root/GoodJob-CRM-Registry-新版本目录
export GOODJOB_ALLOW_LOW_MEMORY=true
./update-registry.sh 新版本号
```

例如：

```bash
cd /root/GoodJob-CRM-Registry-1.7.3
./update-registry.sh 1.7.3
```

更新后检查：

```bash
./manage.sh status
curl -fsS http://127.0.0.1:4188/api/health
```

## 六、宝塔一键更新

1. 首次安装成功后，脚本会自动创建：

```text
/opt/goodjobcrm/ops/baota-update.sh
/opt/goodjobcrm/ops/runtime/
```

2. 如果当前服务器已经安装过 1.7.2，先执行一次：

```bash
install -d -m 0700 /opt/goodjobcrm/ops /opt/goodjobcrm/ops/runtime
cp -a ./deploy/docker-compose/. /opt/goodjobcrm/ops/runtime/
chmod +x /opt/goodjobcrm/ops/runtime/*.sh
install -m 0700 ./baota-update.sh /opt/goodjobcrm/ops/baota-update.sh
```

3. 宝塔“计划任务”新增 Shell 脚本任务，执行用户选 `root`，脚本内容：

```bash
/opt/goodjobcrm/ops/baota-update.sh 1.7.3 >> /opt/goodjobcrm/shared/baota-update.log 2>&1
```

4. 以后电脑发布新镜像后，只需把脚本里的版本号改成新版本，例如 `1.7.3`，再点击宝塔
计划任务“执行”。脚本会自动备份、拉取公开镜像、迁移数据库、启动容器和执行健康检查。
不需要上传部署包，不需要 `docker login`，正常更新不会删除 MySQL 数据卷。

计划任务日志：

```text
/opt/goodjobcrm/shared/baota-update.log
```

## 七、禁止执行

```bash
docker compose down -v
```

该命令会删除 GoodJob 数据卷。正常更新不需要删除容器、网络或卷。

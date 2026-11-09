# GitHub Actions 与 Docker Compose 部署

## 镜像构建与发布

把项目推送到 GitHub，`.github/workflows/docker.yml` 会执行：

1. Python 3.13 下的可移植测试、前端语法检查和 Compose 配置检查。
2. 构建 amd64 测试镜像，验证空库启动、导入、作答、来源校验，并重启容器验证题库、收藏、笔记和成绩仍在。
3. 检查通过后构建 `linux/amd64`、`linux/arm64` 镜像，推送到 GHCR。

镜像地址自动取 GitHub 仓库的小写名称，例如仓库 `YourName/finreg-practice` 对应：

```text
ghcr.io/yourname/finreg-practice:latest
```

| 触发方式 | 发布标签 |
| --- | --- |
| 推送默认分支 | `latest`、`branch-分支名`、`sha-完整提交SHA` |
| 推送其他分支 | `branch-分支名`、`sha-完整提交SHA` |
| 推送 `v1.2.3` 这样的版本标签 | `1.2.3`、`1.2`、`sha-完整提交SHA` |
| 手动运行 Actions | 按所选分支生成标签，默认分支才更新 `latest` |
| Pull request | 只检查和测试镜像，不登录或推送 GHCR |

Actions 的 Summary 会显示实际镜像地址、标签和 digest。发布使用 GitHub 自动提供的 `GITHUB_TOKEN`，不需要配置 Docker Hub 账号或上传个人 token。工作流声明了 `packages: write`；如果组织策略限制写入，需在仓库/组织设置允许发布。已有同名 package 的情况，还需给此仓库授予该 package 的 Actions 访问权。

GHCR package 首次通常为私有。需要匿名拉取时，可在 GitHub Packages 的 package 设置中改为 public；保留私有时，在服务器使用具有 `read:packages` 权限的 GitHub PAT（classic）登录：

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

在密码提示中输入 token，不把 token 写到 Compose、Git 仓库或命令参数中。

## 服务器初次部署

服务器需要 Docker Engine 与 Docker Compose v2。将 `compose.yaml`、`.env.example` 放到同一目录，例如 `/opt/finreg-practice`：

```bash
mkdir -p /opt/finreg-practice
cd /opt/finreg-practice
# 将这两个配置文件放到此目录后执行：
cp .env.example .env
mkdir -p data
```

编辑 `.env`，至少修改镜像名和实际访问来源：

```dotenv
FINREG_IMAGE=ghcr.io/yourname/finreg-practice:latest
FINREG_BIND_ADDRESS=127.0.0.1
FINREG_PORT=8765
FINREG_ALLOWED_ORIGINS=https://study.example.com
FINREG_DATA_DIR=./data
FINREG_UID=1000
FINREG_GID=1000
```

把示例域名替换成你自己的访问地址。`FINREG_ALLOWED_ORIGINS` 必须包含协议和非默认端口，多个来源用逗号分隔。它负责 Host/Origin 校验，不是登录认证。此应用仍是单用户共用一份学习档案；默认只绑定服务器回环地址，适合接入已有认证的反向代理、VPN 或 SSH 隧道，不能作为带独立账号的多用户服务。

容器以 UID/GID 1000 运行，给数据目录写权限后启动：

```bash
sudo chown -R 1000:1000 ./data
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 app
```

如果改了 `.env` 中的 UID/GID，目录所有者也改为相同数值。容器使用 `/healthz` 健康检查；SQLite、图片和原卷全部位于持久化挂载的 `/app/data`。

在服务器本机检查：

```bash
curl -f http://127.0.0.1:8765/healthz
```

返回 `{"status":"ok"}` 表示启动完成。新的空目录会创建空题库，可以在页面导入 JSON；镜像中不包含本地私人题库、学习记录、登录 Cookie 或采集归档。

## 迁移当前电脑的题库和学习记录

想保留当前完整题库，需要把本地数据同步到服务器的 `data` 目录，至少包括：

```text
data/
  practice.sqlite3
  assets/
  sources/
```

`practice.sqlite3` 包括题目、解析、原始字段、会话、作答、收藏和笔记；`assets` 是题图，`sources` 是原卷 PDF。原始采集归档可另行保留，不是日常刷题启动的必要文件。

数据库可以从页面“下载数据库备份”取得，重命名为 `practice.sqlite3`；也可以停止本机服务后复制。运行中不要只复制 SQLite 主文件，以免漏掉 WAL 中尚未合并的修改。迁移时停止服务器容器，再放入数据库与图片并设置目录所有者。不要上传 `session.private.json`、Cookie、QA 数据库和无关备份。

浏览器尚未同步的草稿先让本机页面保存完成。迁移后访问地址改变，浏览器 localStorage 不会跨域迁移；已同步到 SQLite 的草稿会恢复。

## 反向代理或服务器 IP 访问

默认端口只在服务器本机开放。已有 Nginx HTTPS 站点可以添加以下 location，并将 `.env` 的来源设成站点的完整 HTTPS origin：

```nginx
location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 32m;
    proxy_read_timeout 300s;
}
```

这段配置放入你已有的 TLS/认证站点，不包含证书签发或账号配置。代理应保留 Host；应用不会自动信任任意转发来源。

仅在可信内网需要直接通过服务器 IP 访问时，可以修改 `.env`，把下面示例 IP 换成真实服务器地址：

```dotenv
FINREG_BIND_ADDRESS=0.0.0.0
FINREG_PORT=8765
FINREG_ALLOWED_ORIGINS=http://192.0.2.10:8765
```

然后执行 `docker compose up -d`。浏览器访问地址须与配置的协议、主机和端口相符。看到403时优先核对这里和代理传入的 Host，不要用通配来源关闭校验。

## 更新、回退与本地构建

更新代码推送到 GitHub，等 Actions 发布完成后：

```bash
docker compose pull
docker compose up -d
```

数据在宿主机目录中，重建容器会继续使用。更新后刷新原来打开的网页，加载新的前端模块。更新前建议保留数据库备份。

回退时把 `.env` 的 `FINREG_IMAGE` 改成以前的版本标签或 Actions Summary 中记录的 digest，再拉取启动：

```dotenv
FINREG_IMAGE=ghcr.io/yourname/finreg-practice@sha256:REPLACE_WITH_RECORDED_DIGEST
```

若服务器拿到完整源码，也可绕过 GHCR 在服务器本地构建。将 `.env` 的镜像名改为 `finreg-practice:local` 后执行：

```bash
docker compose build
docker compose up -d --pull never
```

## 本次验证范围

本地23项后端测试通过；另在不含私人题库的目录中，CI使用的8项测试也通过。验证包含 Host/Origin 默认拒绝与显式放行、反代和映射端口、空库启动、持久化路径、JSON 导入及 SQLite 完整性。CI的HTTP烟测脚本在原生Python进程中完成写入、进程重启与数据复查，这不替代真实Docker烟测。

Actions配置通过actionlint，Compose和工作流YAML解析通过；引用的各action主版本已确认存在。前端未改变，语法检查通过。

本机没有 Docker 引擎，因此不将静态检查记为镜像构建通过。真实 Docker 构建、容器重启后的持久化烟测及多架构发布由上述 Actions 执行；推送仓库并看到两个 job 成功后才算完成镜像发布。现有依赖私人本地题库的测试不在 CI 中伪造数据通过，CI 明确运行不依赖私人题库的测试及实际容器烟测。

# GitHub Actions 与 Docker Compose 部署

## 服务器部署

服务器安装 Docker Engine 和 Docker Compose v2 后，将 `compose.yaml` 放到部署目录。直接编辑文件里的两处配置：

```yaml
image: ghcr.io/yourname/finreg-practice:latest  # 换成 Actions 发布的实际镜像地址
ports:
  - "8765:8765"  # 左边是服务器端口，右边是容器端口
```

无需 `.env` 文件。数据默认放在 `compose.yaml` 同级的 `data` 目录：

```text
finreg-practice/
  compose.yaml
  data/
    practice.sqlite3
    assets/
    sources/
```

在 `compose.yaml` 所在目录执行：

```bash
mkdir -p data
sudo chown -R 1000:1000 ./data
sudo chmod -R u+rwX ./data
docker compose pull
docker compose up -d
```

容器以 UID/GID 1000 运行，因此第一次部署需要给数据目录和已有文件读写权限。Compose 禁止自动创建宿主机数据目录；未执行上述准备步骤时会直接报告挂载目录不存在，避免 Docker 自动创建 root 所有的目录后导致应用反复重启。查看状态与日志：

```bash
docker compose ps
docker compose logs --tail=100 app
curl -f http://127.0.0.1:8765/healthz
```

健康检查返回 `{"status":"ok"}` 表示启动完成。新目录会自动创建空数据库，可以从页面导入题库。数据库、题图和原卷均保存在 `./data`，更新或重建容器后继续使用。

### 首次登录

应用要求登录。还没有任何账号时，启动日志会打印一次性初始化码：

```bash
docker compose logs app | grep 初始化码
```

打开网站，用初始化码创建管理员账号。从旧版本升级时，已有的练习、作答、收藏和笔记会全部归入这个账号。初始化码在每次重启时重新生成，创建第一个账号后失效；也可以在 `compose.yaml` 的 `environment` 中设置 `FINREG_SETUP_CODE` 指定。之后由管理员在“用户管理”中生成邀请码邀请其他人注册。

管理员忘记密码时：

```bash
docker compose exec app python auth.py reset-password 用户名
```

### SQLite 报错 `unable to open database file`

如果容器反复退出且日志指向 `sqlite3.connect`，先检查服务器的数据目录及数据库文件权限。旧版 Compose 的短格式挂载 `./data:/app/data` 会在目录不存在时自动创建 root 所有的目录；从其他账号复制来的数据库也可能不可写。镜像内对 `/app/data` 设置的所有者会被宿主机挂载覆盖，宿主机登录账号为 UID 1000 并不代表该目录或文件属于 UID 1000。

在 `compose.yaml` 所在目录执行以下命令修复现有部署，无需更新镜像：

```bash
docker compose stop app
mkdir -p ./data
sudo chown -R 1000:1000 ./data
sudo chmod -R u+rwX ./data
docker compose up -d
docker compose logs --tail=50 app
curl -f http://127.0.0.1:8765/healthz
```

使用 `docker-compose` 命令的服务器，将上述 `docker compose` 替换为 `docker-compose` 即可。SQLite 还需要在同目录创建 `practice.sqlite3-wal` 和 `practice.sqlite3-shm`，因此目录和已有数据库文件都必须可写。

如果修复后仍失败，执行下面的只读诊断，确认实际挂载路径、运行用户及权限；检查 `practice.sqlite3` 是否被误建成了目录：

```bash
docker compose run --rm --no-deps --entrypoint sh app -c \
  'id; ls -ldn /app/data; ls -ln /app/data/practice.sqlite3*; test -w /app/data && echo data-directory-writable'
```

## 外部 Nginx

在已有 Nginx 站点中转发到服务器的8765端口即可，应用不做 Host/Origin 白名单校验，也无需配置可信代理：

```nginx
location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 32m;
    proxy_read_timeout 300s;
}
```

`X-Forwarded-Proto` 让应用在 HTTPS 下给登录 Cookie 加上 Secure 标记。公网访问请务必启用 HTTPS，否则密码和登录凭据以明文传输。

如果修改了 Compose 中的服务器端口，同步修改 `proxy_pass`。上例适用于 Nginx 运行在宿主机上；如果 Nginx 也是容器，使用它可访问的应用地址。

## 迁移现有题库

镜像不包含本地私人题库和学习数据。迁移时将数据库 `practice.sqlite3`、题图目录 `assets`、原卷目录 `sources` 放到服务器的 `./data` 中。

数据库可从页面“下载数据库备份”取得并重命名；也可停止原服务后复制，避免遗漏 SQLite WAL 中尚未合并的修改。替换服务器数据前执行 `docker compose stop`，复制完成后运行 `sudo chown -R 1000:1000 ./data`、`sudo chmod -R u+rwX ./data`、`docker compose up -d`。

数据库包含作答、成绩、收藏、笔记和已同步的草稿。浏览器本地尚未保存的草稿应先完成同步。采集 Cookie、`session.private.json` 和 QA 数据库无需迁移。

## 镜像构建与发布

把项目推送到 GitHub 后，`.github/workflows/docker.yml` 会先运行可移植后端测试、前端语法检查和 Compose 检查，再构建测试镜像，验证导入、作答及容器重启后的数据持久化。检查通过后构建 `linux/amd64`、`linux/arm64` 镜像并发布到 GHCR。

镜像地址取 GitHub 仓库的小写名称，例如 `YourName/finreg-practice` 对应 `ghcr.io/yourname/finreg-practice`。Actions Summary 会显示实际地址、标签和 digest。

| 触发方式 | 发布标签 |
| --- | --- |
| 推送默认分支 | `latest`、`branch-分支名`、`sha-完整提交SHA` |
| 推送其他分支 | `branch-分支名`、`sha-完整提交SHA` |
| 推送 `v1.2.3` | `1.2.3`、`1.2`、`sha-完整提交SHA` |
| 手动运行 | 按所选分支生成标签，默认分支才更新 `latest` |
| Pull request | 只检查和测试镜像 |

发布使用 GitHub 自动提供的 `GITHUB_TOKEN`。工作流已声明 `packages: write`，组织策略或已有同名 package 还需允许此仓库发布。

GHCR package 首次通常为私有。可在 GitHub Packages 中改为 public；保留私有时，先在服务器执行 `docker login ghcr.io -u YOUR_GITHUB_USERNAME`，在密码提示中输入具有 `read:packages` 权限的 GitHub PAT（classic）。

## 更新、回退与本地构建

等待 Actions 发布完成后，在部署目录执行：

```bash
docker compose pull
docker compose up -d
```

回退时直接把 `compose.yaml` 的 `image` 改为旧版本标签或 Actions Summary 记录的 digest，再执行上面的命令。更新前保留数据库备份，更新后刷新页面加载新的前端。

拿到完整源码时，可执行 `docker build -t finreg-practice:local .`，将 Compose 的 `image` 改为 `finreg-practice:local`，再执行 `docker compose up -d --pull never`。

## 验证范围

本地验证覆盖反向代理域名下的读取和写入、空库启动、导入、持久化路径与 SQLite 完整性。CI 烟测使用与服务器相同的宿主机目录挂载，先将目录所有者设为 UID/GID 1000，再使用外部域名的 Host/Origin 请求，检查重启后的题库、收藏、笔记和成绩。

本机没有 Docker 引擎；本地原生 Python 的重启烟测和工作流静态检查不代表 Docker 镜像已构建。实际构建、容器烟测和多架构发布需要推送后由 GitHub Actions 执行。

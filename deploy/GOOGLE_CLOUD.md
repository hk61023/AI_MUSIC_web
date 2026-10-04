# Google Cloud 部署

## 架构

Compute Engine e2-small、Ubuntu 24.04 LTS、30 GB 磁盘；Node.js 24、SQLite、FFmpeg、Nginx。公开入口只使用 HTTPS 443，应用 8787 仅绑定 127.0.0.1。媒体使用同区域私有 Cloud Storage 桶，VM 通过绑定的专用服务账号访问，不创建 JSON 密钥。

## 首次准备

项目拥有者在 Cloud Shell 启用 Storage 与 IAM Credentials API，创建 Standard 私有媒体桶，启用统一桶级访问和公共访问防护。只在该桶授予运行账号 roles/storage.objectAdmin，只在该账号自身授予自身 roles/iam.serviceAccountTokenCreator。不要授予项目 Owner/Editor。

固定 VM 外部 IP，配置 HTTPS 防火墙标记。SSH 限制来源之前先验证保留的登录途径，不修改其他实例的共享规则。真实项目、账号、地址、用户名、密钥和口令只保存在本机部署资料与服务器配置，不能提交公开仓库。

## 运行环境与版本部署

将 deploy/install-runtime.sh 上传到新服务器，以 root 执行。它安装经官方 SHA256 校验的 Node.js 24 LTS、FFmpeg、Nginx，创建无登录权限的 tingyu 用户，并关闭 Nginx 默认 HTTP 站点；已有其他网站的服务器不能直接照搬。

将不含凭据、环境变量、数据、Windows node_modules、缓存和本机部署资料的源码包传到 /tmp/tingyu-source.tar.gz。首次配置 SITE_ORIGIN 和 GCS_BUCKET 环境变量后，运行 deploy/prepare-release.sh。该脚本创建新版本目录、安装、构建、测试，通过后切换 /opt/tingyu/current。

持久数据在 /var/lib/tingyu，生产配置在 /etc/tingyu.env（root:tingyu 640），应用由 systemd 启动与恢复。首次管理员口令随机生成，仅保存于 root 可读的 /etc/tingyu-admin-initial-password，不打印进日志。重复部署不得重置现有管理员口令。

本机 scripts/connect-cloud.ps1 使用被忽略的 artifacts/ssh/config；该配置应包含 aimisic-music 别名、私钥路径和受信任的主机公钥。SSH 严格验证主机身份，私钥不得复制到项目或服务器。

## HTTPS

有域名：使用实际 DNS 提供商的 DNS-01 自动验证与续期，保持只开放 443。

无域名：可以使用 Let's Encrypt 的 shortlived IP 证书，官方 lego v5 客户端支持 TLS-ALPN-01 在 443 验证。deploy/install-acme.py 下载并校验官方发布版。将 CERT_IP 和可选 CERT_EMAIL 配置在 root 可读的 /etc/tingyu-tls.env；部署 renew-ip-certificate.sh 及 tingyu-tls.service/timer。

定时器每六小时检查证书，剩余三天时续期。当前独占端口的验证方案仅在实际续期时短暂停止 Nginx，并通过退出处理保证恢复；日常检查不停止网站。高可用需求增加时可用 ALPN 分流方案避免这段停顿。

deploy/nginx.conf 必须替换地址和证书路径；nginx -t 通过才 reload。SITE_ORIGIN 必须与实际 HTTPS 地址完全一致。

## 存储与备份

运行 deploy/verify-gcs.mjs 验证真实上传、复制、签名、私有访问及删除。媒体原始文件/草稿保存在 private 前缀，已发布副本在 published 前缀，访客使用两分钟签名 URL。下架删除已发布副本，已下载或缓冲内容无法撤回。

将 deploy/gcs-lifecycle.json 应用到桶，启用 tingyu-backup.timer 每日备份；本地及云端备份保留 30 天。恢复必须使用 scripts/restore.mjs 写入新目录，不覆盖正在使用的数据库；恢复后验证记录、会话清理及媒体可访问性。

## 验收与费用

验证健康接口、页面、后台权限、实际上传—处理—预览—发布—播放—下载—下架、20 路媒体请求、备份恢复与证书续期。大陆三网、Safari、微信和锁屏需人工实测，不能以本地测试代替。

预算计入 VM、磁盘、IPv4、存储、请求、出站、软删除和日志。具备 Billing 权限的用户配置预算及 50/80/100% 通知；普通告警不会自动停止计费。

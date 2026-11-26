# CloudBase 微信筛查测试

此部署使用静态托管、CloudBase 身份认证和 PostgreSQL。首页收集模拟筛查数据。一次试算只有在页面显示“记录已保存”后才算保存成功。

1. 在独立的测试环境用 CloudBase CLI 或 SQL 编辑器执行 `trial.sql` 一次。业务表存放于私有模式 `osta_trial`，参与者提交和更正由限定用途的数据库函数处理。
2. 使用 CloudBase 身份认证的“用户名密码”登录方式创建内部测试管理员。在 SQL 编辑器将该账号的实际 UID 作为 `subject` 插入 `osta_trial.operators`。后台查询、更新和导出均要求已登录的授权管理员。
3. 在部署进程设置 `CLOUDBASE_ENV_ID` 和 `CLOUDBASE_PUBLISHABLE_KEY`。网页使用匿名角色的 Publishable Key。运行 `node cloudbase/build.mjs <静态输出目录>`，再用 `tcb hosting deploy <静态输出目录> <站点目录> --verify -e <环境ID>` 发布。
4. 参与者用微信打开站点目录下的 `index.html`，管理员通过同一目录下的 `admin.html` 登录。按完整参与者编号筛选可查看其历次记录和导出 CSV。
5. 运行 `node cloudbase/check.mjs <CloudBase CLI 的 JS 入口路径> <环境ID>`，比较部署的 SQL 和网页筛查结果。此检查只读。

腾讯云默认域名用于开发测试。正式启用前按平台要求配置备案自定义域名并在微信内完成验收。[腾讯云默认域名说明](https://docs.cloudbase.net/service/alias)

# 骨衡 · 骨质疏松与体重筛查

中文手机筛查页位于 `/`，管理员入口位于 `/admin`。参与者填写周岁、性别、女性绝经状态、身高及公斤或市斤体重。页面先显示 OSTA，再显示 BMI，并自动提交记录。记录用途在按钮旁说明。

## 计算依据

| 项目 | 实施规则 | 来源 |
| --- | --- | --- |
| OSTA 人群 | 本项目用于亚洲人群。仅对年满 18 周岁、自报已绝经的女性分层，男性、未绝经、绝经状态不确定及未成年人显示原因。 | [Koh 等，Osteoporosis International，2001；12:699–705](https://pubmed.ncbi.nlm.nih.gov/11580084/) |
| OSTA 指数 | （体重公斤数 − 周岁）× 0.2，最后去掉小数，负数向零截断。例如 −0.9 得 0，−4.9 得 −4。 | [Fukushima Journal of Medical Science，Methods 中的 OSTA 定义](https://www.jstage.jst.go.jp/article/fms/advpub/0/advpub_25-00036/_html/-char/ja) |
| OSTA 筛查风险 | 整数指数 > −1 为低风险，−4 至 −1（含两端）为中风险，< −4 为高风险。结果用于初筛，骨质疏松诊断需由医生进一步评估。 | [国家卫生健康委《成人骨质疏松症食养指南（2026年版）》附录“亚洲人骨质疏松自我筛查工具”](https://www.nhc.gov.cn/sps/c100087/202604/a69d2fce21e040dc96cbc40b923a06d3/files/%E9%99%84%E4%BB%B63.%E6%88%90%E4%BA%BA%E9%AA%A8%E8%B4%A8%E7%96%8F%E6%9D%BE%E7%97%87%E9%A3%9F%E5%85%BB%E6%8C%87%E5%8D%97%EF%BC%882026%E5%B9%B4%E7%89%88%EF%BC%89.pdf) |
| BMI | 公斤数 ÷ 身高（米）的平方。18 岁及以上按未修约值分类：<18.5 体重过低，18.5≤BMI<24 体重正常，24≤BMI<28 超重，BMI≥28 肥胖。未成年人仅显示数值。成人标准不适用于孕产妇、运动员等特殊人群。 | [国家卫生健康委 WS/T 428—2013《成人体重判定》表 1](https://www.nhc.gov.cn/ewebeditor/uploadfile/2013/08/20130808135715967.pdf) |

1 市斤 = 0.5 公斤。以输入值的整数比例比较 BMI 边界，页面通常保留一位小数。如果舍入会让实际低于界值的结果显示成界值，页面增加显示位数。

## 记录与权限

- 首次筛查生成随机编号和独立随机复测凭证。保存后可复制两项，复测时填写。拥有编号本身无法读取历史或追加记录。复测凭证仅授权新增筛查。
- 每次提交使用独立请求标识。数据库事务和唯一键保证双击、丢失回执及重试均只保存一次。失败时页面保留结果；同标签页刷新后仍可重试。保存成功即删除该标签页的待提交副本。
- 服务端重新计算两项指标。更正通过记录版本校验更新原行并保留筛查日期；复测新增一行。管理员可按编号、北京时间日期、风险和跟进状态筛选，导出相同筛选下的明细。汇总先取每人最近一条记录，再筛选；不适用单列。
- 正式端运行在 ChatGPT Sites 的可信登录网关及 D1 数据库上。服务端检查网关注入的用户身份和管理员邮箱白名单。缺少身份或名单时，记录读取、更新和 CSV 端点均拒绝访问。部署到其他主机时须替换身份验证适配，禁止直接将身份请求头作为互联网来访者的凭证。
- 源代码使用 [Vant 官方示例](https://github.com/vant-ui/vant-demo)，评估了 MIT 许可的 [vant/vite](https://github.com/vant-ui/vant-demo/tree/master/vant/vite) 和 [vant/cdn](https://github.com/vant-ui/vant-demo/tree/master/vant/cdn)。沿用项目已有的 Vue 3.5.13 和 Vant 4.9.21 本地发行包、按钮组件及响应式表单。浏览器从站点自身加载脚本及样式。第三方许可证位于 `web/vendor/`。

## 本地运行和测试

使用 Node.js 24。构建与核心测试无须下载依赖。

```sh
node scripts/build.mjs
node --test tests/*.test.mjs
node scripts/local.mjs
```

本地地址为 `http://127.0.0.1:4173`。可在启动前通过进程环境设置仅供本地使用的 `LOCAL_ADMIN_PASSWORD`，然后从管理入口登录。未设置时本地管理员登录关闭。本地数据库位于已被 Git 忽略的 `.local/`。自动化测试使用内存数据库和临时生成的口令。浏览器测试可使用 Playwright 1.57.0 和 Chromium，运行 `node tests/mobile.mjs`。也可用 `BROWSER_PATH` 指定已安装 Chrome 的可执行文件。

## 正式部署与二维码

1. 使用 `.openai/hosting.json` 绑定的 ChatGPT Sites 项目。配置服务端机密环境变量 `ADMIN_EMAILS` 为受权管理员的 ChatGPT 登录邮箱，多个邮箱以英文逗号分隔。保留 D1 绑定 `DB`，随首次部署应用 `drizzle/0000_screening.sql`。
2. 在允许访问 Sites 源代码服务的环境中，将同一版本同步到该站点的源分支，运行 `node scripts/build.mjs` 并发布 Worker。站点访问范围需允许公众匿名打开筛查首页；后台 API 继续执行身份核验。
3. 使用正式 HTTPS 地址完成匿名填写、同一记录后台核对、已授权管理员登录及 CSV 下载，确认匿名读取遭拒。只在验证后，用正式首页地址生成 PNG 二维码；二维码中仅编码网址。

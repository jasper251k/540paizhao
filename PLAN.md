# 540拍照 · 开发方案

拍照出片用的手机网页 App：把小红书参考图挂到地图机位上，自动排出地铁+步行最省时的路线，出门照着走、照着拍。

本文件是开发的唯一依据，每完成一步更新「进度」一节。

## 已确认需求（2026-10-18）

- 出行：99% 地铁+步行，偶尔某段骑车。机位多在地铁站附近，城市默认上海。
- 只在手机上规划和使用，不需要云端同步。
- 起点：用户填写（默认上次的出发地）；**终点：回家，路线要算上回家这段**。
- 分一天还是两天：排路线前 App 问一声，由用户决定；两天时用户把机位分到各天，每天默认从出发地出发、最后回家。
- **待拍收藏夹**：平时刷到好图先存成机位，周末从里面挑几个建行程；拍过的自动标记，不重复去。
- 不做衣服功能：点机位弹出参考图，用户自己知道穿哪套。
- 时间功能可选、做简版：偶尔有傍晚机位，打个标签即可，时间用户自己算。
- 照片无法自动识别地点：地点由用户搜索或在地图上长按落点。
- 记录每次行程数据，以后用来建议分一天还是两天（现在只记录，不做建议）。

## 技术选型

- Vite + React + TypeScript，纯前端，无后端、无服务器。
- 高德 JS API 2.0：地图、`AMap.AutoComplete` / `AMap.PlaceSearch`（搜地名）、`AMap.Transfer`（公交地铁）、`AMap.Walking`、`AMap.Riding`。
- Dexie（IndexedDB）：存数据和图片 Blob。
- vite-plugin-pwa：离线缓存、添加到主屏幕。
- JSZip：导出 / 导入备份。
- 部署：GitHub Pages（用 gh CLI），国内打不开再换 Cloudflare Pages。
- 不引入大型 UI 库，CSS 手写，以手机竖屏为主。

## 数据结构

```ts
type Place = { name: string; lng: number; lat: number }

type Spot = {            // 机位，存在收藏夹里
  id: string
  name: string
  address?: string
  lng: number; lat: number
  photoIds: string[]     // 可挂多张参考图
  note?: string
  tags: string[]         // 如 '傍晚'
  status: 'todo' | 'shot'
  shotAt: number[]       // 每次点「已拍」的时间戳
  createdAt: number
}

type Photo = { id: string; spotId: string; full: Blob; thumb: Blob }
// full：长边 1600px，JPEG 质量 0.82；thumb：长边 240px

type Day = {
  spotIds: string[]                          // 优化后的顺序
  start: Place; end: Place
  legModes: ('transit' | 'walk' | 'ride')[]  // 每段交通方式，长度 = spotIds.length + 1
  departTime?: string                        // 可选，'HH:mm'
}

type Trip = { id: string; title: string; date: string; days: Day[]; createdAt: number; finishedAt?: number }

type LegCache = {        // 两点间路线缓存，减少高德请求
  key: string            // `${mode}:${两端坐标保留5位小数后排序拼接}`
  duration: number       // 秒
  distance: number       // 米
  segments: unknown      // 高德返回的分段信息（换乘线路、站名），用于展示
  fetchedAt: number
}

type Settings = {
  amapKey: string; amapSecurityCode: string
  home: Place
  lastStart?: Place
  defaultStayMin: number // 每个机位默认停留分钟，用于粗略到达时间，默认 30
}
```

行程记录不单独存，由 Trip + Spot.shotAt 推出：点数、天数、计划总用时、实际用时（第一次「已拍」到最后一次）。

## 页面

1. **收藏夹（首页）**：地图显示全部机位，标记是参考图缩略图；已拍的变灰。可切换列表视图、按待拍/已拍筛选。右下角「+」添加机位。多选机位 →「建行程」。
2. **机位编辑**：搜地名或地图长按落点；从相册选图（可多张）；小红书链接；备注；标签（傍晚等）。
3. **行程规划**：出发地（默认上次）、终点（默认家）→ 问「一天还是两天」→ 两天时把机位分到第 1 天 / 第 2 天 → 排路线（显示查询进度）→ 结果页。
4. **行程执行（出门用）**：地图上标记显示序号 + 缩略图，画出路线；底部按顺序列出每段（几号线、几站、多少分钟），每段有「高德导航」按钮、可切换骑车；每个机位点开看大图，有「已拍」按钮。
5. **设置**：高德 Key 和安全密钥、家的地址、默认停留时长、导出 / 导入备份、存储用量。

## 路线算法

- 节点：起点 + 当天机位 + 终点。起点、终点固定，只排中间机位。
- 两点用时：
  - 默认 `AMap.Transfer`（city 上海，策略选最快）。
  - 直线距离 < 1 km，或 Transfer 无方案时，用 `AMap.Walking`。
  - 用户把某段切换为骑车后，对该段调用 `AMap.Riding` 重算。
- 地铁用时视为对称：A→B 与 B→A 共用一条缓存，先查 LegCache，没有才请求。
- 请求排队，每次间隔约 350ms，防止超出高德 QPS 限制；界面显示「正在查路线 3/15」。
- 排序：机位 ≤ 7 个时全排列暴力求总用时最短（7! = 5040）；更多时用最近邻 + 2-opt。
- 两天行程：每天单独排序。

## 跳转高德导航

```
https://uri.amap.com/navigation?from={lng},{lat},{名称}&to={lng},{lat},{名称}&mode={bus|walk|ride}&src=540paizhao&callnative=1
```

装了高德 App 会直接打开 App 导航。

## 图片

- `<input type="file" accept="image/*" multiple>` 选图；iOS 会把 HEIC 自动转成 JPEG。
- 用 canvas 压缩成 full + thumb 两份存进 IndexedDB，原图不保存。

## 存储与备份

- 启动时调用 `navigator.storage.persist()`。
- 首次打开时提示：请「添加到主屏幕」后从图标打开（iPhone 上 Safari 和主屏幕图标的数据是分开的）。
- 导出：zip（`data.json` + `photos/`），用 `navigator.share` 存到「文件」/ iCloud，不支持时改为下载。
- 导入：选 zip，可选覆盖或合并。

## 高德 Key 安全

- Key 和安全密钥不写进代码仓库，在设置页填写，只存在本机，导出备份时包含。
- 高德控制台给 Key 设域名白名单：`<GitHub 用户名>.github.io`。开发期间先不设白名单，或加上电脑的局域网 IP。

## 开发约定

- 用户电脑只有 8GB 内存：只开一个 `npm run dev -- --host`，不装 Docker，不用重型框架。
- 手机和电脑连同一个 Wi-Fi，用局域网地址在手机上实测。
- 每一步做完让用户在手机上试，没问题再进下一步。

## 步骤与验收

| 步骤 | 内容 | 验收标准 |
|---|---|---|
| 0 | 用户注册高德开发者（个人实名，创建「Web端(JS API)」Key）、GitHub 账号 | 拿到 Key 和安全密钥；`gh auth status` 已登录 |
| 1 | 搭项目；设置页填 Key；地图；搜索 / 长按添加机位；收藏夹列表；数据存本地 | 手机上添加 3 个机位，刷新后还在 |
| 2 | 参考图上传压缩；地图缩略图标记；点开看大图；小红书链接、备注、标签 | 地图上看到参考图标记，点开是大图 |
| 3 | 建行程；两点用时查询 + 缓存；最优排序（含回家）；画路线；分段详情；跳高德；单段切骑车 | 5 个机位排出合理顺序，点导航能打开高德 App |
| 4 | 一天 / 两天分配；「已拍」打勾并同步收藏夹状态；行程记录；粗略到达时间 | 两天行程能分开排；拍完的机位在收藏夹变灰 |
| 5 | PWA（添加到主屏幕、离线打开）；导出 / 导入备份；部署 GitHub Pages | 手机从主屏幕图标打开，电脑关机也能用 |

## 以后再做

- 根据行程记录建议分一天还是两天。

## 进度

- 2026-10-18：方案确定，待用户完成步骤 0。
- 2026-10-18：GitHub 已登录（gh CLI，账号 jasper251k）。还缺高德 Key。部署地址预计为 `jasper251k.github.io/<仓库名>`。git 全局未设置 user.name/email，建仓库时在仓库内单独设置。
- 2026-10-18：高德 Key 已申请（用户自己保存，在 App 设置页填写）。App 定名「540拍照」。
- 2026-10-18：步骤 1 代码完成，在 `app/` 目录（Vite + React + TS + Dexie）。文件：`src/db.ts`（数据表）、`src/amap.ts`（加载高德）、`src/pages/Settings.tsx`、`src/pages/Home.tsx`（地图、选点模式、列表、长按/右键新建）、`src/components/PlaceSearch.tsx`、`src/components/SpotEditor.tsx`（名字、小红书链接、备注、标签、已拍、删除）。类型检查通过，待用户手机实测。启动：`cd app && npx vite --host`。
- 2026-10-18：步骤 1 用户实测通过。用户要求去掉小红书链接，只上传参考图（已从数据结构删掉 xhsUrl）。
- 2026-10-18：步骤 2 代码完成。`src/photos.ts`（压缩、useBlobUrl）、`SpotEditor` 加选图 / 删图 / 设封面、新增 `SpotViewer`（点机位先看大图，左右滑，点图全屏，「拍完了」按钮，再点「编辑」）。地图标记和列表显示封面缩略图，已拍的变灰。待手机实测。
- 2026-10-18：已提前部署（局域网访问不通：电脑开着 VPN 类隧道 utun6 抢了默认路由）。公开仓库 github.com/jasper251k/540paizhao，网址 https://jasper251k.github.io/540paizhao/ 。以后改完运行 `./deploy.sh` 发布（构建后强推 gh-pages 分支）。`vite.config.ts` 构建时 base 为 `/540paizhao/`。
- 2026-10-18：步骤 3 代码完成，并提前做了步骤 4 的一天/两天分配和估算到达时间。`src/routing.ts`（高德 Transfer/Walking/Riding 查询、350ms 限流、LegCache 缓存 30 天、≤8 个点全排列否则最近邻+2-opt、跳高德导航链接）、`pages/Trips.tsx`（行程列表）、`pages/Planner.tsx`（名字、出发地、终点默认家、可选出发时间、一天/两天、勾选待拍机位并分天）、`pages/TripView.tsx`（地图画线+序号标记、分段详情、高德导航、单段改骑车、已拍、删除行程）。首页顶栏加「行程」入口。db 升到 version 2（trips、legs 表）。< 1 km 直接步行，地铁查不到也退回步行。待手机实测高德返回字段是否与代码一致。
- 2026-10-18：用户要求：路线结果要以地图为主、能直观看到怎么走，并且每个机位直接在地图上显示要拍的参考图。已改 TripView：每段按地铁(蓝实线)/公交(紫)/步行(绿虚线)/骑车(橙)分截画线并加白描边，地铁公交上车点标线路名；机位标记 = 参考图缩略图 + 序号；底部面板默认收起，只显示图例和一排按顺序的参考图；「看全程」按钮；点某段路线（地图上或列表里）地图缩放到该段。路线缓存 key 加 v2 前缀（新增 parts 字段）。另加 `.claude/settings.json` 放行 npm/npx/git/deploy。
- 2026-10-19：修复行程页地图不显示：高德已加载时，地图初始化早于行程读库完成，容器还没渲染，之后不再重试。初始化改为同时依赖 hasDay。
- 2026-10-19：行程页顶栏「删除」换成「编辑」，新增 `components/TripEditor.tsx`：机位「不去了」、移到另一天、从收藏夹加待拍机位；保存时只给机位变了的那天重新排路线（没变的保留原路线和骑车设置），某天清空则去掉这天。删除行程挪到路线详情最底部。
- 2026-10-19：用户觉得路线乱、看不出流向。TripView 加了：每段路中点「1 → 2」标签；「一段段看」模式（只亮当前段、其余变淡，顶部卡片显示从哪到哪、怎么走、上一段/下一段/高德导航）；「▶ 播放路线」小红点按顺序沿路线走一遍。

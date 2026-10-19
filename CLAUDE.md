# 540拍照

拍照出片用的手机网页 App：把小红书参考图挂到地图机位上，按地铁+步行排最优路线（含回家），出门照着走、照着拍。

- 线上：https://jasper251k.github.io/540paizhao/ （仓库 jasper251k/540paizhao，公开）
- 用户只在 iPhone 主屏幕 App 上用；数据存在手机本地（IndexedDB），不做云同步，暂不给朋友用。
- 用户不写代码，按量付费：回复用中文、简短、少术语；大改动先说规模再做。
- 用户只能在这台电脑的 VS Code 里用 Claude Code（走 API），用不了网页版或 App。所以发布就用本机 `./deploy.sh`，不需要 GitHub 自动发布。

## 新对话先看什么

1. 本文件（自动加载）。
2. 需要背景时，只读 [PLAN.md](PLAN.md) 的「进度」最后 5～10 条，不要整篇读。
3. 再按需检索 `app/src` 里相关文件，不要通读整个项目。

## 改代码的流程

1. 改 `app/src` 下的文件。
2. 检查：`cd app && npx tsc -b && npx eslint src`（目前有 2 条已知 warning，可忽略）。
3. 发布：在仓库根目录运行 `./deploy.sh`，约 1 分钟后手机关掉 App 再打开即更新。
4. 提交：`git add -A && git commit && git push`。
5. **收尾时在 PLAN.md「进度」末尾追加一两行**：这次用户要了什么、做了什么决定、改了哪些文件。

改数据结构时要升级 Dexie 版本（`src/db.ts`），不能让手机里的旧数据丢失。

## 代码地图

| 文件 | 作用 |
|---|---|
| `src/db.ts` | 数据表：spots 机位、photos 参考图、trips 行程、legs 路线缓存、settings |
| `src/amap.ts` | 加载高德、地图样式 |
| `src/routing.ts` | 查路线（地铁/步行/骑车）、排顺序、高德导航链接 |
| `src/parseGroups.ts` | 批量导入的自然语言识别（规则版，无 AI） |
| `src/backup.ts` | 导出/导入 zip 备份 |
| `src/pages/Home.tsx` | 首页收藏夹地图、列表 |
| `src/pages/Import.tsx` | 批量导入 |
| `src/pages/Planner.tsx` | 新建行程 |
| `src/pages/TripView.tsx` | 行程地图：分段路线、播放、逐段看、照片弹出 |
| `src/components/TripEditor.tsx` | 行程内增删机位、换天 |
| `src/index.css` | 全部样式（苹果风格，含深色模式） |

## 用户已确认的偏好

- 出行 99% 地铁+步行，偶尔骑车；城市默认上海。
- 不要衣服功能；不要小红书链接，只传图。
- 地图上照片默认收起，点机位才弹出；路线要能直观看出流向。
- UI 要苹果式简洁。
- 批量导入不接 AI（免费、规则识别）；用户习惯语音说「第一张到第三张是武康大楼，第四张到第六张是……」。

## 以后可能做（用户提过但没做）

- 接 AI 识别更随意的说法：已确认 DeepSeek API 允许本站跨域直连，不用搭中转。
- 分享给朋友：方案是「邀请链接」带上用户的高德 Key。
- 根据行程记录建议拍一天还是两天。

# 台灣資金緊俏每日儀表板

公開市場研究用途的台灣短期資金監測工具。它追蹤同日 TFSS（90D TAIBIR 初級市場減 3M TAIBOR）、90D 初次級利差、金融業隔夜拆款與央行 NCD 淨發行，另設 IRB 銀行與臺灣銀行控制組的季頻監測。

## 架構

純靜態網站，全部跑在 GitHub 上：

- **前端**：Vite + React，發布到 GitHub Pages
- **資料更新**：GitHub Actions 排程（UTC `0 4 * * 1-5`，即台灣時間週一至週五 12:00）執行 `scripts/refresh.ts`，抓取官方公開資料、計算指標，寫回 `public/data/dashboard.json`、`public/data/history.json` 並自動 commit
- **研究摘要**：規則式模板（`scripts/lib/insight.ts`），依 TFSS 燈號與 5 日變化套用預寫文字，不呼叫任何外部 AI API
- **手動更新**：到 repo 的 Actions 頁籤，選 `更新資料並部署` → `Run workflow`

沒有伺服器、沒有資料庫、沒有登入機制，也沒有任何會產生費用的外部服務。

## 本機啟動

```bash
npm install
npm run dev
```

手動跑一次資料更新（會寫入 `public/data/`）：

```bash
npm run refresh
```

## 資料與限制

TFSS 只在 TAIBIR 和 TAIBOR 日期相同時發布；資料缺漏時保留最後有效快照。研究摘要為規則式模板文字，並非投資建議或個人化交易指令。

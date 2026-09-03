# 台灣資金緊俏每日儀表板

公開市場研究用途的台灣短期資金監測工具。它追蹤同日 TFSS（90D TAIBIR 初級市場減 3M TAIBOR）、90D 初次級利差、金融業隔夜拆款與央行 NCD 淨發行，另設 IRB 銀行與臺灣銀行控制組的季頻監測。

## 本機啟動

```bash
npm install
npm run dev
```

以 `npx netlify dev` 測試 Netlify Functions。首次部署後，請在 Netlify：

1. 啟用 Identity 並設定 Registration 為 **Invite only**。
2. 邀請管理者，並於 Identity 將其 `app_metadata.roles` 設為 `admin`。
3. 設定 `OPENAI_API_KEY`、`OPENAI_MODEL`（預設 `gpt-5-mini`）與長隨機值 `INTERNAL_REFRESH_SECRET`。

不要將金鑰提交至 Git。排程為 UTC `0 4 * * 1-5`（台灣時間週一至週五 12:00）。

## 資料與限制

每次更新會儲存來源回應與標準化快照。TFSS 只在 TAIBIR 和 TAIBOR 日期相同時發布；資料缺漏時保留最後有效快照。AI 結論是公開市場研究觀點，並非投資建議或個人化交易指令。

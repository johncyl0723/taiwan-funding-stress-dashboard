/**
 * 每個指標的「意義說明」靜態文字。與第二大腦 vault 的 concept note 對齊，
 * 兩邊改動時要一起更新。這裡只放不隨日期變動的知識；當日解讀由
 * scripts/lib/insight.ts 依實際數字產生。
 */
export interface Definition {
  key: string
  title: string
  /** 這個指標在量什麼 */
  meaning: string
  /** 怎麼判讀 */
  reading: string
  /** 已知限制，誠實揭露 */
  caveat?: string
  unit: string
  frequency: '日' | '週' | '月' | '事件'
}

export const LAYERS: { key: string; label: string; lead: string }[] = [
  {
    key: 'policy',
    label: '央行政策',
    lead: '央行透過定期存單（NCD）調節市場上的台幣數量，並以貼放利率界定利率走廊。這一層決定資金的「供給」。'
  },
  {
    key: 'interbank',
    label: '銀行間價格',
    lead: '銀行之間互相拆借的價格。準備部位鬆緊會先反映在隔夜拆款，再傳到 1 週至 3 個月的 TAIBOR。'
  },
  {
    key: 'bills',
    label: '票券與企業融資',
    lead: '資金成本傳到企業端。企業發行商業本票（CP）的實際利率，以及票券商願不願意承銷新券。'
  },
  {
    key: 'composite',
    label: '合成與判讀',
    lead: '把上面各層的價格訊號標準化後合成單一指數，並套用材料性、絕對水準與季節性三道修正。'
  }
]

export const DEFINITIONS: Record<string, Definition> = {
  tss: {
    key: 'tss',
    title: 'TSS 資金緊俏綜合指數',
    meaning:
      '把五個日頻子指標各自轉成 120 日 z-score（相對自身近一年歷史的異常程度）後等權平均，再取 5 日移動平均。單一價差容易被雜訊帶偏，合成後才有辨識力。',
    reading:
      '5 日均 z 越高代表資金越緊。1.0 以上開始偏緊、1.5 以上明顯緊俏、2.0 以上異常壓力。負值代表比近一年常態還寬鬆。',
    caveat:
      '門檻是常態分配近似的初值，尚未以真實壓力事件校準 —— 回測區間（2022 年起）不含這類事件。',
    unit: 'z-score',
    frequency: '日'
  },
  ncdNetIssuance: {
    key: 'ncdNetIssuance',
    title: '央行 NCD 淨發行',
    meaning:
      '央行定期存單當日發行金額減到期金額，近 5 個交易日合計。正值代表央行從市場收回台幣（淨吸收流動性），負值代表釋出。這是台灣最主要的沖銷工具。',
    reading:
      '5 日合計持續為正且隔拆同時走高，代表緊俏是央行主動造成的；為負但隔拆仍走高，代表壓力來自央行以外（外資流出、稅期）。判斷「緊俏的來源」比判斷「緊俏的程度」更靠這個指標。',
    caveat: '公告只回補約 12 個交易日，樣本要累積到 30 日才會進入 TSS 合成。',
    unit: '百萬元',
    frequency: '日'
  },
  ncdOutstanding: {
    key: 'ncdOutstanding',
    title: 'NCD 未到期餘額',
    meaning: '央行透過定期存單鎖住的台幣存量。淨發行是流量，這是累積後的存量。',
    reading: '餘額持續上升代表央行在加碼沖銷；餘額下降但隔拆沒有跟著降，代表到期釋出的資金被其他因素吸走了。',
    unit: '億元',
    frequency: '日'
  },
  corridor: {
    key: 'corridor',
    title: 'O/N 走廊位置',
    meaning:
      '把隔夜拆款利率放進央行利率走廊裡看它站在哪個位置。0 代表貼著下限（7 天期 NCD 發行利率），1 代表觸及上限（重貼現率）。單看「隔拆 0.82%」沒有意義，要看它在走廊的哪一段。',
    reading: '台灣隔拆長期幾乎貼著下限，位置接近 0。明顯脫離下限往上走就是緊俏訊號，不需要等到接近上限。',
    caveat: '走廊寬度 1.175 個百分點，但隔拆實際擺動不到其中 1.5%，離散度太小，目前未通過材料性檢定。',
    unit: '%',
    frequency: '日'
  },
  overnight: {
    key: 'overnight',
    title: '金融業隔夜拆款利率',
    meaning: '銀行之間隔夜無擔保拆借的加權平均利率，是銀行準備部位鬆緊最即時的價格。',
    reading: '5 個交易日內上行超過 5 bp 代表準備部位明顯偏緊。TAIBOR 與票券利率的變動通常落後它一到三天。',
    unit: '%',
    frequency: '日'
  },
  taibor: {
    key: 'taibor',
    title: '3M TAIBOR',
    meaning:
      '台北金融業拆款定盤利率，由 15 家報價銀行每日 11:00 定盤。3 個月期是企業聯貸與授信合約最常用的計息基準，直接決定公司的利息費用。',
    reading: '它是報價利率不是成交利率，變動遲鈍 —— 通常隔拆已經先動了，TAIBOR 才跟上。',
    unit: '%',
    frequency: '日'
  },
  taiborSlope: {
    key: 'taiborSlope',
    title: 'TAIBOR 1W–3M 斜率',
    meaning: '3 個月期減 1 週期，代表銀行間對「未來一季會不會更緊」的預期。',
    reading: '斜率擴大＝預期未來更緊或升息；收斂甚至倒掛＝預期放鬆。理監事會前一週的變化最有資訊量。',
    caveat: '實測 120 日標準差僅 0.08 bp，2σ 只等於 0.16 bp 的擺動，目前未通過材料性檢定。',
    unit: 'bp',
    frequency: '日'
  },
  tfss: {
    key: 'tfss',
    title: 'TFSS 票券相對銀行間溢酬',
    meaning:
      '90 天期 TAIBIR 初級市場利率減 3 個月 TAIBOR。分子是企業發 CP 的成本，減項是銀行間報價，價差同時包含信用溢酬與流動性溢酬，性質接近 TED spread。',
    reading:
      '價差擴大代表企業票券融資相對銀行貸款變貴，此時改用銀行額度較划算；收斂則是發 CP 的窗口。',
    caveat:
      '不是純粹的資金鬆緊指標。政策升息時兩隻腳同步上移，價差不變 —— 回測已驗證三次升息都正確沒有亮燈。',
    unit: 'bp',
    frequency: '日'
  },
  primarySecondary: {
    key: 'primarySecondary',
    title: '90D 初級－次級利差',
    meaning:
      'TAIBIR 初級市場利率減次級市場利率，也就是票券商承銷新券時要求的額外報酬。不含銀行間因素，是最純的供給面壓力指標。',
    reading:
      '利差擴大代表票券商不想承銷（保證額度吃緊或自身資金成本上升），企業發 CP 要付更多；收斂代表承銷競爭激烈。',
    unit: 'bp',
    frequency: '日'
  },
  taibirSlope: {
    key: 'taibirSlope',
    title: 'TAIBIR 30–180D 斜率',
    meaning: '票券市場的期限溢酬：180 天期減 30 天期的利率差。',
    reading:
      '曲線陡代表短天期相對便宜，滾動發短券划算但要承擔續發風險；曲線平坦或倒掛時，拉長天期鎖定成本較有利。',
    unit: 'bp',
    frequency: '日'
  },
  foreignNet: {
    key: 'foreignNet',
    title: '外資買賣超',
    meaning:
      '外資及陸資在台股的買賣差額，近 5 個交易日合計。這是新台幣流動性最大的外生來源 —— 外資匯出時央行常進場賣匯阻貶，等於同步從銀行體系抽走台幣。',
    reading: '連續大額淨賣超且新台幣同時走貶，通常領先隔拆利率一到兩週。單日金額雜訊大，要看累計。',
    caveat: '只涵蓋股市，不含債市與直接投資；央行是否干預只能推測。',
    unit: '百萬元',
    frequency: '日'
  }
}

export const FX_DEFINITIONS: Record<string, Definition> = {
  sofr: {
    key: 'sofr',
    title: 'USD SOFR 90 日均',
    meaning:
      '美元無擔保隔夜融資利率的替代基準，由紐約聯準銀行依美國公債附買回交易計算。銀行的美元貸款多以 SOFR 平均值加碼定價。',
    reading: '這是外幣借款的美元端成本基準。',
    unit: '%',
    frequency: '日'
  },
  fxSpread: {
    key: 'fxSpread',
    title: '名目利差（SOFR − 3M TAIBOR）',
    meaning: '美元基準利率與台幣基準利率的差。正值代表美元名目上比台幣貴。',
    reading:
      '這只是「表面上」的比較。真正該比的是避險後的隱含台幣成本 ＝ 美元利率 ＋ 換匯點年化。名目利差大不代表該借台幣。',
    caveat:
      '換匯點資料尚未接上（臺灣銀行遠期牌告未驗證），因此目前算不出避險後成本，這個數字只能給方向。',
    unit: 'bp',
    frequency: '日'
  },
  usdTwd: {
    key: 'usdTwd',
    title: 'USD/TWD 收盤匯率',
    meaning: '銀行間新台幣對美元收盤匯率，資料來源為台北外匯經紀公司。',
    reading:
      '看水準也看 20 日年化波動。波動升高時，未避險外幣借款的風險成本上升；若外資大額賣超而匯率卻不動，多半是央行在進場調節。',
    caveat: '若公司本身有外幣收入形成自然避險，匯率波動的權重可以調低。',
    unit: '',
    frequency: '日'
  }
}

export const MONTHLY_HINTS: Record<string, string> = {
  excessReserve: '銀行實際準備超過法定應提的部分，代表體系剩餘流動性總量。存量厚時，緊俏通常是短暫的。',
  reserveMoney: '通貨發行額加金融機構準備金，是貨幣供給的基礎。',
  m1bYoY: 'M1B 年增率跌破 M2 年增率（死亡交叉）代表資金由活存轉向定存與外幣，市場資金活性下降。',
  m2YoY: '廣義貨幣成長率，央行的中間目標。',
  governmentDeposits: '稅款入庫時資金由銀行體系移入國庫，等額抽走銀行準備。5 月與 9 月最明顯。',
  bigFiveBaseRate:
    '五家公股行庫牌告基準利率平均，是談授信加碼時的外部參照。註：原訂指標為「新承做放款利率」，但央行只提供 XLS／ODS，改以基準利率替代，資訊量較低。'
}

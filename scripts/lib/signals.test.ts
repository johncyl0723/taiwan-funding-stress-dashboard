import { describe, expect, it } from 'vitest'
import { dailySignal, monthlySignal } from '../../src/signals'
import type { HistoryPoint, MonthlySeries } from '../../src/types'

const point = (overrides: Partial<HistoryPoint> = {}): HistoryPoint => ({
  date: '2026-09-23',
  compositeInputs: { tfss: null, primarySecondary: null, taiborSlope: null, corridor: null, ncdNetIssuance: null },
  excludedInputs: [],
  foreignNet5d: null,
  ncdNetIssuance5d: null,
  ncdOutstanding: null,
  corridorPosition: null,
  overnightRate: null,
  taibor3m: null,
  taiborSlopeBp: null,
  ...overrides
} as unknown as HistoryPoint)

/** 120 個交易日的平坦歷史，最後一天可覆寫 */
const flatHistory = (key: keyof HistoryPoint, base: number, latest: number): HistoryPoint[] =>
  Array.from({ length: 120 }, (_, index) => point({ [key]: index === 119 ? latest : base } as Partial<HistoryPoint>))

describe('量：資金水位增減', () => {
  const history = [point()]

  it('外資淨買超＝水位增加，淨賣超＝水位減少，金額很小＝持平', () => {
    expect(dailySignal('foreignNet', point({ foreignNet5d: 38_876 }), history)).toMatchObject({ label: '水位增加', arrow: '▲', tone: 'loose' })
    expect(dailySignal('foreignNet', point({ foreignNet5d: -206_343 }), history)).toMatchObject({ label: '水位減少', arrow: '▼', tone: 'tight' })
    expect(dailySignal('foreignNet', point({ foreignNet5d: 9_999 }), history)).toMatchObject({ label: '水位持平', arrow: '▶' })
  })

  it('NCD 淨吸收＝水位減少，淨釋出＝水位增加（方向與外資相反）', () => {
    expect(dailySignal('ncdNetIssuance', point({ ncdNetIssuance5d: 150_000 }), history)).toMatchObject({ label: '水位減少', arrow: '▼' })
    expect(dailySignal('ncdNetIssuance', point({ ncdNetIssuance5d: -310_700 }), history)).toMatchObject({ label: '水位增加', arrow: '▲' })
  })

  it('NCD 餘額下降＝水位增加，變動小於餘額 0.5% 視為持平', () => {
    const drop = [point({ ncdOutstanding: 6_000_000 }), ...Array(4).fill(point()), point({ ncdOutstanding: 5_700_000 })]
    expect(dailySignal('ncdOutstanding', point({ ncdOutstanding: 5_700_000 }), drop)).toMatchObject({ label: '水位增加', arrow: '▲' })

    const tiny = [point({ ncdOutstanding: 5_720_000 }), ...Array(4).fill(point()), point({ ncdOutstanding: 5_700_000 })]
    expect(dailySignal('ncdOutstanding', point({ ncdOutstanding: 5_700_000 }), tiny)).toMatchObject({ label: '水位持平' })
  })

  it('資料不完整時明說資料不足，不亂給方向', () => {
    expect(dailySignal('foreignNet', point(), history)).toMatchObject({ label: '資料不足', tone: 'reference' })
  })
})

describe('價：寬鬆或緊縮', () => {
  const history = [point()]
  const tfss = (z: number | null) => dailySignal('tfss', point({
    compositeInputs: { tfss: z, primarySecondary: null, taiborSlope: null, corridor: null, ncdNetIssuance: null }
  } as Partial<HistoryPoint>), history)

  it('TFSS／初次級用 z-score，門檻與 TSS 同一套（1.0、1.5），0.5 以上只標「略偏」', () => {
    expect(tfss(0.3)).toMatchObject({ label: '中性', tone: 'neutral' })
    expect(tfss(0.86)).toMatchObject({ label: '中性・略偏緊', tone: 'neutral' })
    expect(tfss(1.2)).toMatchObject({ label: '偏緊', tone: 'tight' })
    expect(tfss(1.8)).toMatchObject({ label: '緊縮', tone: 'severe' })
    expect(tfss(-0.7)).toMatchObject({ label: '中性・略偏鬆' })
    expect(tfss(-1.2)).toMatchObject({ label: '偏鬆', tone: 'loose' })
    expect(tfss(-2)).toMatchObject({ label: '寬鬆', tone: 'loose' })
  })

  it('z-score 缺值（被材料性檢定排除）時引用排除原因，不硬判', () => {
    const signal = dailySignal('primarySecondary', point({
      excludedInputs: [{ key: 'primarySecondary', reason: '標準差過小' }]
    } as Partial<HistoryPoint>), history)
    expect(signal).toMatchObject({ label: '資料不足' })
    expect(signal?.basis).toContain('標準差過小')
  })

  it('走廊位置：貼近下限＝寬鬆，明顯上移才偏緊', () => {
    const at = (position: number) => dailySignal('corridor', point({ corridorPosition: position }), history)
    expect(at(-0.009)).toMatchObject({ label: '寬鬆', tone: 'loose' })
    expect(at(0.1)).toMatchObject({ label: '中性' })
    expect(at(0.2)).toMatchObject({ label: '偏緊', tone: 'tight' })
    expect(at(0.4)).toMatchObject({ label: '緊縮', tone: 'severe' })
  })

  it('隔拆／TAIBOR 看與近 120 日中位數的差距（bp），不用 z-score 以免放大雜訊', () => {
    const noise = flatHistory('overnightRate', 0.824, 0.8244)
    expect(dailySignal('overnight', noise.at(-1)!, noise)).toMatchObject({ label: '中性' })

    const jump = flatHistory('overnightRate', 0.824, 0.934)
    expect(dailySignal('overnight', jump.at(-1)!, jump)).toMatchObject({ label: '緊縮', tone: 'severe' })

    const mild = flatHistory('overnightRate', 0.824, 0.854)
    expect(dailySignal('overnight', mild.at(-1)!, mild)).toMatchObject({ label: '偏緊', tone: 'tight' })

    const easing = flatHistory('taibor3m', 1.7, 1.55)
    expect(dailySignal('taibor', easing.at(-1)!, easing)).toMatchObject({ label: '寬鬆', tone: 'loose' })
  })

  it('歷史不足 30 個交易日時不判讀', () => {
    const short = flatHistory('overnightRate', 0.824, 0.9).slice(-10)
    expect(dailySignal('overnight', short.at(-1)!, short)).toMatchObject({ label: '資料不足' })
  })
})

describe('不硬湊方向的指標', () => {
  it('外幣與期限溢酬形狀標「參考指標」', () => {
    for (const key of ['sofr', 'fxSpread', 'usdTwd', 'taibirSlope']) {
      expect(dailySignal(key, point(), [point()])).toMatchObject({ label: '參考指標', tone: 'reference' })
    }
  })

  it('history 尚未載入或市場資料缺席時回傳 null，畫面先不顯示徽章', () => {
    expect(dailySignal('foreignNet', point({ foreignNet5d: 50_000 }), [])).toBeNull()
    expect(dailySignal('foreignNet', null, [point()])).toBeNull()
    expect(dailySignal('未知指標', point(), [point()])).toBeNull()
  })
})

describe('月頻背景卡片', () => {
  const series = (key: string, values: number[], unit = '億元'): MonthlySeries => ({
    key, label: key, unit, hint: '', sourceUrl: '',
    points: values.map((value, index) => ({ period: `2026-${String(index + 1).padStart(2, '0')}`, value }))
  })
  // 前面幾期小幅波動，最後一期給出明確變動
  const wobble = [500, 510, 495, 505, 500, 510, 495, 505]

  it('超額準備、準備貨幣：增加＝水位增加', () => {
    expect(monthlySignal(series('excessReserve', [...wobble, 700]))).toMatchObject({ label: '水位增加', arrow: '▲' })
    expect(monthlySignal(series('excessReserve', [...wobble, 300]))).toMatchObject({ label: '水位減少', arrow: '▼' })
  })

  it('政府存款方向相反：增加＝資金流向國庫＝水位減少', () => {
    expect(monthlySignal(series('governmentDeposits', [...wobble, 700]))).toMatchObject({ label: '水位減少', arrow: '▼' })
    expect(monthlySignal(series('governmentDeposits', [...wobble, 300]))).toMatchObject({ label: '水位增加', arrow: '▲' })
  })

  it('M1B／M2 年增率用「成長加速／放緩」，不說水位增減', () => {
    expect(monthlySignal(series('m2YoY', [7, 7.1, 6.9, 7, 7.1, 6.9, 7, 7.1, 8], '%'))).toMatchObject({ label: '成長加速', arrow: '▲' })
    expect(monthlySignal(series('m1bYoY', [7, 7.1, 6.9, 7, 7.1, 6.9, 7, 7.1, 5], '%'))).toMatchObject({ label: '成長放緩', arrow: '▼' })
  })

  it('變動落在近期波動的 0.25 倍以內視為持平', () => {
    expect(monthlySignal(series('excessReserve', [...wobble, 505.5]))).toMatchObject({ label: '水位持平', arrow: '▶' })
  })

  it('牌告基準利率：上調＝偏緊、下調＝偏鬆、持平＝中性', () => {
    expect(monthlySignal(series('bigFiveBaseRate', [3.3, 3.32, 3.32], '%'))).toMatchObject({ label: '中性' })
    expect(monthlySignal(series('bigFiveBaseRate', [3.32, 3.345], '%'))).toMatchObject({ label: '偏緊', tone: 'tight' })
    expect(monthlySignal(series('bigFiveBaseRate', [3.32, 3.195], '%'))).toMatchObject({ label: '寬鬆', tone: 'loose' })
  })

  it('期數不足或未知指標不亂標', () => {
    expect(monthlySignal(series('excessReserve', [500]))).toBeNull()
    expect(monthlySignal(series('somethingElse', [1, 2, 3]))).toBeNull()
  })
})

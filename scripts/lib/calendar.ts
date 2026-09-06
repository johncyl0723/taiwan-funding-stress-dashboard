import type { EventFlag } from '../../src/types.js'

/**
 * 農曆春節初一。農曆換算需要完整曆法表，這裡只列儀表板可能用到的年份；
 * 表外年份不會亮「農曆年前」旗標，而不是給出錯誤日期。
 */
const LUNAR_NEW_YEAR: Record<number, string> = {
  2009: '01-26', 2010: '02-14', 2011: '02-03', 2012: '01-23', 2013: '02-10',
  2014: '01-31', 2015: '02-19', 2016: '02-08', 2017: '01-28', 2018: '02-16',
  2019: '02-05', 2020: '01-25', 2021: '02-12', 2022: '02-01', 2023: '01-22',
  2024: '02-10', 2025: '01-29', 2026: '02-17', 2027: '02-06', 2028: '01-26',
  2029: '02-13', 2030: '02-03'
}

/**
 * 央行理監事會實際開會日。未列入的年份退回「3／6／9／12 月 18–28 日」的近似窗格，
 * 因此這個旗標只用於提示，不用於精確事件研究。
 */
const BOARD_MEETINGS: string[] = [
  '2022-03-17', '2022-06-16', '2022-09-22', '2022-12-15',
  '2023-03-23', '2023-06-15', '2023-09-21', '2023-12-14',
  '2024-03-21', '2024-06-13', '2024-09-19', '2024-12-19',
  '2025-03-20', '2025-06-19', '2025-09-18', '2025-12-18',
  '2026-03-19', '2026-06-18', '2026-09-17', '2026-12-17'
]

const dayOf = (iso: string) => Number(iso.slice(8, 10))
const monthOf = (iso: string) => Number(iso.slice(5, 7))
const yearOf = (iso: string) => Number(iso.slice(0, 4))

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

/** 該月最後一天 */
function lastDayOfMonth(iso: string): number {
  return new Date(Date.UTC(yearOf(iso), monthOf(iso), 0)).getUTCDate()
}

/**
 * 資金市場的季節性事件。這些日子資金偏緊是常態，不是訊號，
 * 因此燈號不因旗標升級，只在研究摘要中標註。
 */
export function eventFlags(iso: string): EventFlag[] {
  const flags: EventFlag[] = []
  const month = monthOf(iso)
  const day = dayOf(iso)
  const year = yearOf(iso)

  if (month === 5) flags.push('綜所稅期')
  if (month === 9) flags.push('營所稅暫繳')
  if (month === 7 || month === 8) flags.push('除息旺季')

  // 季底：季末月的最後 5 個日曆日
  if ([3, 6, 9, 12].includes(month) && day > lastDayOfMonth(iso) - 5) flags.push('季底')
  if (month === 12 && day >= 20) flags.push('年底')

  const lunar = LUNAR_NEW_YEAR[year]
  if (lunar) {
    const gap = daysBetween(`${year}-${lunar}`, iso)
    if (gap >= 0 && gap <= 14) flags.push('農曆年前')
  }

  const exact = BOARD_MEETINGS.find(meeting => Math.abs(daysBetween(meeting, iso)) <= 7)
  if (exact) flags.push('理監事會前後')
  else if (!BOARD_MEETINGS.some(meeting => meeting.slice(0, 4) === String(year))
    && [3, 6, 9, 12].includes(month) && day >= 18 && day <= 28) {
    flags.push('理監事會前後')
  }

  return flags
}

export const hasSeasonalFlag = (flags: EventFlag[]) =>
  flags.some(flag => flag !== '理監事會前後')

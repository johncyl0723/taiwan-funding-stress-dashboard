import type { BankQuarterlyMetric } from './types'

// 每家公開揭露位置不同；此註冊表使季報來源可被逐一審核與更新，絕不讓 AI 推測監理數字。
export const trackedBanks: Array<Pick<BankQuarterlyMetric, 'bank' | 'isIrb' | 'sourceUrl'>> = [
  { bank: '合作金庫', isIrb: true, sourceUrl: 'https://www.tcb-bank.com.tw/' },
  { bank: '第一銀行', isIrb: true, sourceUrl: 'https://www.firstbank.com.tw/' },
  { bank: '兆豐銀行', isIrb: true, sourceUrl: 'https://www.megabank.com.tw/' },
  { bank: '台北富邦銀行', isIrb: true, sourceUrl: 'https://www.fubon.com/banking/' },
  { bank: '國泰世華銀行', isIrb: true, sourceUrl: 'https://www.cathaybk.com.tw/' },
  { bank: '玉山銀行', isIrb: true, sourceUrl: 'https://www.esunbank.com/' },
  { bank: '中國信託銀行', isIrb: true, sourceUrl: 'https://www.ctbcbank.com/' },
  { bank: '臺灣銀行', isIrb: false, sourceUrl: 'https://www.bot.com.tw/' }
]

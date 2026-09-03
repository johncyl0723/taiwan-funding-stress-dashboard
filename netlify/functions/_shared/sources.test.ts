import { describe, expect, it, vi } from 'vitest'
import { fetchMarketSources } from './sources'

const tdcc = `<p>營業日：2026-09-03</p><table><tr><td>Fixing Rate</td><td>1.8</td><td>1.9</td><td>2.0</td><td>2.1</td><td>2.2</td></tr></table>`
const taibor = `<p>3 Month 1.7000</p>`
const overnight = `<p>金融業隔夜拆款加權平均 0.8230</p>`
const ncd = `<p>發行 4,698 億元，到期 3,168.5 億元</p>`

describe('official source parsing', () => {
  it('normalizes a complete same-day market response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.includes('tdcc') ? tdcc : url.includes('taibor') ? taibor : url.includes('lp-641') ? overnight : ncd)))
    const values = await fetchMarketSources()
    expect(values.date).toBe('2026-09-03')
    expect(values.taibir90Primary).toBe(2.2)
    expect(values.ncdNetIssuance).toBe(152950)
  })

  it('rejects incomplete official values instead of inventing data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<p>營業日：2026-09-03</p>')))
    await expect(fetchMarketSources()).rejects.toThrow('資料尚未完整定盤')
  })
})

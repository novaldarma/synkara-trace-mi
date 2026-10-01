// Two published 2018 national averages, not the UCI facility's contracted tariff.
// Korean Energy Agency/KEPCO: industrial sale price, KRW per kWh.
// US Federal Reserve G.5A: annual average KRW per US dollar.
export const INDUSTRIAL_PRICE_2018_KRW_PER_KWH = 106.46
export const FX_2018_KRW_PER_USD = 1099.2926
export const INDUSTRIAL_BENCHMARK_USD_PER_KWH = INDUSTRIAL_PRICE_2018_KRW_PER_KWH / FX_2018_KRW_PER_USD
export const PRICE_SOURCE = 'https://tips.energy.or.kr/statistics/statistics_view0703.do'
export const FX_SOURCE = 'https://www.federalreserve.gov/releases/g5a/20210104/'

export function indicativeUsd(kwh: number) {
  return kwh * INDUSTRIAL_BENCHMARK_USD_PER_KWH
}

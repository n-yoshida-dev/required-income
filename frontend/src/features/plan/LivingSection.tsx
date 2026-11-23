/**
 * 「計画」の暮らしの区分（SPEC §4.2。T21）：生活費・家賃・市区町村。
 * 畳み「前提を確かめる」に 積立の利回り・物価の上がり方・住宅ローンの金利（既定の出どころの注も）。
 */

import { appDefaults, mortgageRateLabel } from '../../data/appData'
import { MoneyField, MunicipalityField, RateField } from '../shared/fields/Fields'
import { formatPercent } from '../shared/format'
import { Fold } from './Fold'
import { fieldState, type PlanEditor } from './planEditor'

/** 前提の欄の印の頭（誤りがあれば畳みを開く） */
const ASSUMPTIONS_PREFIX = 'assumptions.'

type Props = { editor: PlanEditor }

/** 暮らしの区分の中身 */
export function LivingSection({ editor }: Props) {
  const { plan } = editor
  const foldHasIssue = [...editor.issues.keys()].some((key) => key.startsWith(ASSUMPTIONS_PREFIX))

  return (
    <>
      <div className="plan__block">
        <MoneyField
          label="生活費"
          perMonth
          {...fieldState(editor, 'living.monthlyLivingCost')}
          value={plan.living.monthlyLivingCost}
          onChange={(monthlyLivingCost) =>
            editor.set('living.monthlyLivingCost', {
              ...plan,
              living: { ...plan.living, monthlyLivingCost },
            })
          }
        />
        <MoneyField
          label="家賃"
          perMonth
          {...fieldState(editor, 'living.monthlyRent')}
          value={plan.living.monthlyRent}
          onChange={(monthlyRent) =>
            editor.set('living.monthlyRent', { ...plan, living: { ...plan.living, monthlyRent } })
          }
        />
        <MunicipalityField
          label="市区町村"
          {...fieldState(editor, 'municipality')}
          value={plan.municipality}
          onChange={(code) => editor.set('municipality', { ...plan, municipality: code })}
        />
      </div>

      <Fold summary="前提を確かめる" forceOpen={foldHasIssue}>
        <RateField
          label="積立の利回り"
          unit="%/年"
          {...fieldState(editor, 'assumptions.investmentReturnRate')}
          value={plan.assumptions.investmentReturnRate}
          onChange={(investmentReturnRate) =>
            editor.set('assumptions.investmentReturnRate', {
              ...plan,
              assumptions: { ...plan.assumptions, investmentReturnRate },
            })
          }
        />
        <RateField
          label="物価の上がり方"
          unit="%/年"
          {...fieldState(editor, 'assumptions.inflationRate')}
          value={plan.assumptions.inflationRate}
          onChange={(inflationRate) =>
            editor.set('assumptions.inflationRate', {
              ...plan,
              assumptions: { ...plan.assumptions, inflationRate },
            })
          }
        />
        {/* 既定値は毎月変わる値なので、どの月の何の金利かを欄の下に出す */}
        <RateField
          label="住宅ローンの金利"
          unit="%/年"
          note={`既定：${mortgageRateLabel}（${formatPercent(appDefaults.assumptions.mortgageRate.value)}）`}
          {...fieldState(editor, 'assumptions.mortgageRate')}
          value={plan.assumptions.mortgageRate}
          onChange={(mortgageRate) =>
            editor.set('assumptions.mortgageRate', {
              ...plan,
              assumptions: { ...plan.assumptions, mortgageRate },
            })
          }
        />
      </Fold>
    </>
  )
}

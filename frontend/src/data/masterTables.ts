/**
 * `data/` の制度マスタ JSON を `MasterTables` に束ねる。**計算に使う JSON はここだけが import する。**
 * 表示専用の `data/municipality/codes.json`（自治体コード → 名前）は計算に関わらないので例外で、
 * `features/shared/municipality.ts` が直接読む。
 *
 * domain 層は JSON を直接読まず引数で受け取る契約なので（`.claude/rules/domain-purity.md`）、
 * 束ねる場所を1か所に固定しておく。テストの `tests/domain/fixtures.ts` も同じ形で束ねているが、
 * テストは「JSON の形が型から外れたら落ちる」ことを兼ねているため、あえて共有しない。
 */

import childAllowanceJson from './benefit/child-allowance.json'
import childcareFreeJson from './childcare/free-education.json'
import childcareMealFeeJson from './childcare/mealFee.json'
import highSchoolSupportJson from './benefit/high-school-support.json'
import incomeTaxJson from './tax/income-tax.json'
import nationalInsuranceJson from './tax/national-insurance.json'
import residentTaxJson from './tax/resident-tax.json'
import schoolCostJson from './education/school-cost.json'
import socialInsuranceJson from './tax/social-insurance.json'
import universityCostJson from './education/university-cost.json'
import type { MasterTables } from '../domain/types'

/** 制度のマスタデータの束。`data/appData.ts` が NISA の上限を足して `evaluate` に渡す */
export const masterTables: MasterTables = {
  childAllowance: childAllowanceJson.values,
  highSchoolSupport: highSchoolSupportJson.values,
  // 主食費は国の目安が無く、無償化の JSON とは別ファイル（給食費の実額調査）に既定値を置いている
  childcare: {
    ...childcareFreeJson.values,
    standardMonthlyStapleFoodCost: childcareMealFeeJson.values.appDefault.stapleFoodMonthly,
  },
  schoolCost: schoolCostJson.values,
  universityCost: universityCostJson.values,
  incomeTax: incomeTaxJson.values,
  socialInsurance: socialInsuranceJson.values,
  residentTax: residentTaxJson.values,
  nationalInsurance: nationalInsuranceJson.values,
}

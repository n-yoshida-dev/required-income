/**
 * 前の版から残した計算（税・社会保険・収入・教育費・児童手当・就学支援金・保育・ローン・車・積立）の型。
 *
 * 新しい中核（`domain/plan/`）の型は `domain/plan/types.ts`（SPEC §1）。前の版の入力・出力の型
 * （`SimulationInput`・逆算の結果など）は T13 で消した（タグ `v1-final`）。
 * コメントの「SPEC §2.x」は前の版の SPEC（`docs/archive/v1/SPEC.md`）の節。
 *
 * 金額はすべて円単位の整数（`Yen`）。万円で持たない。
 * 割合はすべて小数（`Rate`）。2% は 0.02 であって 2 ではない。
 */

import type { Rate, Yen } from './money'

// 金額と割合の型はここからも引けるようにする。
// domain の利用側が money.ts と types.ts の両方を import しなくて済むようにするため。
export type { Rate, Yen } from './money'

// ---------------------------------------------------------------------------
// 基本の単位
// ---------------------------------------------------------------------------

/** 西暦。元号は入力層で西暦に変換してから domain に渡す */
export type Year = number

/** 月（1〜12）。完済月や購入月など、年の途中で切り替わるものに使う */
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

/** 世帯員の識別子。表示名は domain では扱わない（個人情報を持ち込まないため） */
export type PersonId = string

/** 自治体コード（総務省の全国地方公共団体コード）。制度データのファイル名に対応する */
export type MunicipalityCode = string

// ---------------------------------------------------------------------------
// 世帯
// ---------------------------------------------------------------------------

/** 世帯員。氏名は持たない */
export type Person = {
  id: PersonId
  birthYear: Year
  /** 就労を終える年齢。年金開始年齢とは別 */
  retirementAge: number
  /** 寿命の想定。シミュレーションの終端を決める */
  lifeExpectancy: number
}

/**
 * 子。教育費と児童手当の計算に使う。
 *
 * **進路は段階ごとに持つ。** 中学の公私で塾に通う期間が数年ずれ、
 * 金額が数百万円動くため、高校だけでは足りない。
 */
export type Child = {
  id: PersonId
  birthYear: Year
  /** 学年の進み方は birthMonth で決まる（4月2日〜翌4月1日生まれが同学年） */
  birthMonth: Month
  elementarySchoolType: 'public' | 'private'
  juniorHighType: 'public' | 'private'
  highSchoolType: 'public' | 'private'
  universityType: UniversityType
  /**
   * 高校の授業料の年額。**就学支援金の額を決めるのに要る。**
   *
   * 支援金は「授業料の月額」と「支給限度額」の小さい方なので（法第5条第1項）、
   * 授業料が限度額を下回る学校では支援金もそこで頭打ちになり、
   * 限度額だけでは自己負担を出せない。
   *
   * `null` なら学習費のマスタデータにある標準額を使う。
   * **子ごとに持つ。** 兄弟で進学先が違えば授業料も違うため。
   */
  annualHighSchoolTuition: Yen | null
  /**
   * 塾に通う期間と月謝。子ごとに持つ（中学受験するかどうかで期間が変わる）。
   *
   * **統計の平均値をそのまま使わない。** 文部科学省の補助学習費は
   * 塾に通っていない世帯を含めた平均なので、実際に通わせる世帯では過小になる。
   */
  cramSchoolPeriods: readonly CramSchoolPeriod[]
}

/** 大学の進路。学費のプリセットを引くキーになる */
export type UniversityType =
  'none' | 'nationalPublic' | 'privateHumanities' | 'privateScience' | 'privateMedical'

/** 大学の通学形態。自宅外は生活費の仕送りが乗る */
export type UniversityLiving = 'fromHome' | 'awayFromHome'

// ---------------------------------------------------------------------------
// 収入
// ---------------------------------------------------------------------------

/**
 * 収入源。**種類ごとに税と社会保険の扱いが違うため、合算した数値では持たない。**
 *
 * - `employment`  給与所得。健康保険・厚生年金・雇用保険は労使折半
 * - `business`    事業所得。国民健康保険・国民年金を全額自己負担する
 * - `realEstate`  不動産所得。社会保険はないが課税所得には合算される
 * - `sideBusiness` 副業。ゴールシークが「埋めるべき額」として動かす対象
 *
 * `sideBusiness` を `business` と分けているのは、税務上の違いではなく
 * **逆算で動かしてよい収入かどうか**を区別するため。
 * 税務上の扱いは `taxCategory` で指定する。
 */
export type IncomeSource = EmploymentIncome | BusinessIncome | RealEstateIncome | SideBusinessIncome

/** 給与所得（会社員） */
export type EmploymentIncome = {
  kind: 'employment'
  personId: PersonId
  /** 額面の年収（賞与を除く） */
  annualGross: Yen
  /** 賞与の年額（額面） */
  annualBonus: Yen
  /** 昇進しなかった場合の年次昇給率 */
  baseRaiseRate: Rate
  /**
   * 賞与が年に何回に分けて支給されるか。社会保険料の賞与の上限（厚生年金は 1 回あたり）を掛けるのに使う。
   * 賞与が 0 なら使われない。人ごとに違うので世帯の前提値ではなくここに持つ（D10）
   */
  bonusPaymentCount: number
}

/** 事業所得（個人事業主） */
export type BusinessIncome = {
  kind: 'business'
  personId: PersonId
  /** 事業を開始する年。この年より前は 0 として扱う */
  startYear: Year
  startMonth: Month
  /** 年間の売上 */
  annualRevenue: Yen
  /** 年間の必要経費 */
  annualExpenses: Yen
  /** 売上の年次成長率 */
  revenueGrowthRate: Rate
  /** 売上の上限。成長させ続けないための天井。上限なしなら null */
  revenueCeiling: Yen | null
  /** 申告方式。青色なら特別控除が引ける */
  filingType: FilingType
}

/** 申告方式。青色申告特別控除の額が変わる */
export type FilingType = 'blue65' | 'blue55' | 'blue10' | 'white'

/** 不動産所得（賃貸に出している物件からの収入） */
export type RealEstateIncome = {
  kind: 'realEstate'
  personId: PersonId
  /** 物件の識別子。`InvestmentProperty` と対応する */
  propertyId: string
  /** 満室時の月額家賃 */
  monthlyRent: Yen
  /** 稼働率。空室リスクを織り込む */
  occupancyRate: Rate
  /**
   * 持分割合。共有名義の場合は収入も経費もこの割合で按分する。
   * 単独名義なら 1。
   */
  ownershipShare: Rate
}

/** 副業。ゴールシークが動かす対象 */
export type SideBusinessIncome = {
  kind: 'sideBusiness'
  personId: PersonId
  annualRevenue: Yen
  annualExpenses: Yen
  /** 税務上どちらで申告するか */
  taxCategory: 'business' | 'miscellaneous'
  /**
   * 事業として申告するときの申告方式。**同じ人に本業の事業（`BusinessIncome`）があれば、そちらの申告方式が優先される**
   * （1 人の事業所得に申告方式は 1 つ）。雑所得で申告するなら使われない
   */
  filingType: FilingType
}

/**
 * 副業所得の年次スケジュール。**ゴールシークが探索中の候補、または解いた結果を差し込むためのもの。**
 *
 * `HouseholdIncomeInput.sideBusinessSchedule`（`income/household.ts`）に入れると、`incomes` の `sideBusiness` の
 * 所得は**使われず**、このスケジュールの額に置き換わる（上乗せではない）。
 * 逆算の答えは「副業でいくら要るか」の総額であって、入力の見込み額との差ではないため。
 *
 * 利用者がフォームから設定するものではない。通常の順方向シミュレーションでは `null` にする。
 */
export type SideBusinessSchedule = {
  /** 誰の副業として計上するか。その人が就労を終えた翌年からは 0 になる */
  personId: PersonId
  /**
   * 期間ごとの副業所得（経費を引いたあとの年額）。**期間は重ならない。**
   * どの期間にも含まれない年は 0 として扱う。
   */
  periods: readonly SideBusinessPeriod[]
}

/** 副業所得の期間1つぶん。`fromYear` と `toYear` の両方を含む */
export type SideBusinessPeriod = {
  fromYear: Year
  toYear: Year
  /** この期間の各年の副業所得（経費を引いたあと） */
  annualProfit: Yen
}

/**
 * 昇進シナリオ。複数を並べて比較する。
 * 「3年後に課長」「5年後に課長」「昇進なし」のような分岐を表す。
 *
 * **1つのシナリオが世帯全体の前提を表す。**
 * 共働きで両方が会社員なら昇進の軸は2本になるため、世帯員ごとの `tracks` を持つ。
 * 「本人だけ昇進」「両方昇進」「どちらも昇進なし」を1つの単位で比較できるようにするため。
 */
export type PromotionScenario = {
  id: string
  /** 世帯員ごとの昇進の予定。昇進を見込まない人は含めなくてよい */
  tracks: readonly PromotionTrack[]
}

/** 1人ぶんの昇進の道筋。`steps` が空なら昇進なし（基本昇給のみ） */
export type PromotionTrack = {
  personId: PersonId
  /** 昇進の予定。`year` の昇順で持つ */
  steps: readonly PromotionStep[]
}

/** 昇進1回ぶん。その年から額面が置き換わる */
export type PromotionStep = {
  year: Year
  /** 昇進後の額面年収（賞与を除く） */
  annualGross: Yen
  annualBonus: Yen
}

// ---------------------------------------------------------------------------
// 居住地
// ---------------------------------------------------------------------------

/**
 * 居住の履歴。**転居すると保育料の階層表・国民健康保険の料率・家賃が変わる。**
 *
 * `fromYear` の昇順で持つ。ある年の居住地は「その年以下で最大の fromYear」を引く。
 */
export type ResidenceHistory = readonly ResidencePeriod[]

/**
 * ある時点から住み始める場所。
 *
 * **家賃をここに持たせているのは、家賃が上がるのが引っ越しの時だからである。**
 * 同じ家に住み続けている間、家賃は据え置かれるのが日本の賃貸の実態で、
 * 毎年インフレ率で逓増させると必要年収を過大に見積もる。
 */
export type ResidencePeriod = {
  fromYear: Year
  municipality: MunicipalityCode
  /** 月額家賃。持ち家・実家などで家賃が発生しないなら null */
  monthlyRent: Yen | null
  /**
   * 入居時の一時費用（敷金・礼金・仲介手数料・引越業者・家具家電）。
   * 転居した年に一括計上する。最初の期間（既に住んでいる家）は 0。
   */
  moveInCost: Yen
}

// ---------------------------------------------------------------------------
// 支出・資産
// ---------------------------------------------------------------------------

/** ローンの条件。元利均等返済のみを扱う */
export type LoanTerms = {
  /** 借入額 */
  principal: Yen
  annualRate: Rate
  years: number
}

/** 車。買い替えサイクルを持つ */
export type Car = {
  /** 最初の購入年。既に保有しているなら過去の年を入れる */
  firstPurchaseYear: Year
  price: Yen
  downPayment: Yen
  loan: LoanTerms | null
  /** 買い替えの周期（年） */
  replacementCycleYears: number
  /** 下取り率。購入時価格に対する割合 */
  resaleRate: Rate
  /** 年間維持費（税・保険・車検・燃料・駐車場） */
  annualUpkeep: Yen
  /** 購入前に使っているカーシェア等の年額。購入年以降は維持費に置き換わる */
  annualPrePurchaseMobilityCost: Yen
}

/**
 * 保有している収益不動産。自宅とは別物。
 * 収入側は `RealEstateIncome` が対応する。
 */
export type InvestmentProperty = {
  id: string
  /** 現在の評価額 */
  currentValue: Yen
  /** ローン残債。無ければ 0 */
  remainingLoan: Yen
  /** 年間の固定資産税 */
  annualPropertyTax: Yen
  /** 年間の管理費・管理委託料 */
  annualManagementCost: Yen
  /** 年間の修繕費 */
  annualRepairCost: Yen
  /** 保有方針 */
  disposition: PropertyDisposition
}

/** 収益不動産をどうするか */
export type PropertyDisposition =
  | { kind: 'hold' }
  | {
      kind: 'sell'
      year: Year
      /** 売却見込額 */
      expectedPrice: Yen
      /** 取得費。譲渡所得税の計算に使う。不明なら null（概算取得費で置く） */
      acquisitionCost: Yen | null
      /**
       * 取得した年。長期譲渡か短期譲渡かの判定に使う（税率が倍近く違う）。
       *
       * 所有期間は譲渡した年の1月1日時点で数えるため、月が無くても
       * 「売却年 − 取得年」だけで判定が一意に決まる（前の版の `asset/property.ts` 参照。タグ `v1-final` にある）。
       *
       * 不明なら null（**長期として扱う**）。取得年が分からないのは取得が古い・
       * 相続で引き継いだ物件が typical で、相続は被相続人の取得日を引き継ぐため
       * 長期になるのが通例。短期のうちに売る予定の物件では必ず入力すること。
       */
      acquisitionYear: Year | null
    }

// ---------------------------------------------------------------------------
// 教育・老後・前提値
// ---------------------------------------------------------------------------

/** 教育費の設定。子ごとの進路と塾は `Child` が持ち、ここには世帯共通の設定を置く */
export type EducationPlan = {
  /** 大学の通学形態 */
  universityLiving: UniversityLiving
  /**
   * 習い事・スポーツ・文化活動の年額（子1人あたり）。塾とは別枠。
   *
   * `null` なら学習費のマスタデータにある平均値（その他の学校外活動費）を使う。
   * 具体的な希望がある世帯は金額を入れて上書きする。
   */
  annualLessonCost: Yen | null
  /** 自宅外通学の場合の年間仕送り。自宅通学なら使われない */
  annualAllowanceAwayFromHome: Yen
}

/** 塾に通う期間と月謝 */
export type CramSchoolPeriod = {
  /** 開始学年（小1 = 1、中1 = 7、高1 = 10、大1 = 13） */
  fromGrade: number
  toGrade: number
  monthlyFee: Yen
}

// ---------------------------------------------------------------------------
// 保育（保育園・認定こども園）
// ---------------------------------------------------------------------------

/**
 * 子1人ぶんの保育園の利用。**フェーズ1は手入力**（SPEC §2.5）。
 *
 * 保育料は自治体の階層表を前年の市町村民税所得割額で引いて決まるが、
 * その自動計算は住民税の実装とセットでフェーズ2に置く。
 * フェーズ1は「今いくら払っているか」を受け取り、
 * **無償化されるクラス年齢に達した年から自動で 0 円にする**ところだけを担う。
 *
 * **歳児クラスは誕生日ではなく、その年度の4月1日時点の年齢で決まる。**
 * 学年と同じ切り方になるので、早生まれ（1〜3月生まれ）は1年早く上がる。
 *
 * 保育園に通わない子（幼稚園・家庭保育）は、この型を持たせなければよい。
 */
export type ChildcareEnrollment = {
  childId: PersonId
  /**
   * 保育園に通い始める年。既に通っているなら起点年以前の年を入れる。
   *
   * 終わりは入力しない。小学校へ入学する年の前年までが対象で、
   * そこから先は生年月から自動的に決まる。
   */
  fromYear: Year
  /**
   * 保育料の月額。**無償化されるクラス年齢に達した年から 0 になる。**
   *
   * 入力された額には多子軽減・住民税非課税世帯の減免が既に反映されている前提で扱う。
   * フェーズ1は階層表を引かないため、**所得が伸びても額が上がらない。**
   * 実際には前年所得で階層が上がるので、ここは費用を下振れさせる側に倒れている。
   */
  monthlyFee: Yen
  /**
   * 保育料以外に園へ払う実費の月額（教材費・行事費・延長保育料など）。
   * 保育料が有償の期間のぶん。
   */
  monthlyExtraCost: Yen
  /**
   * 無償化されたあとの実費の月額。
   *
   * **保育料が 0 になっても支払いは 0 にならない。**
   * 3歳児クラス以降は給食費（主食費・副食費）が実費徴収に切り替わるため、
   * 実費そのものが上がる。無償化の前後を同じ額で置くと、
   * 無償化の年の落ち込みを実際より大きく見せてしまう。
   *
   * **`null` なら `monthlyExtraCost + マスタデータの副食費の目安 + 主食費の既定値` を使う。**
   * これから3歳児クラスに上がる子の給食費は、利用者にはまだ分からない額であるため、
   * 入力必須にすると埋められない。今の実費に給食費が乗るという構造だけを置いて、
   * 金額はマスタデータから引く。
   */
  monthlyExtraCostAfterFree: Yen | null
}

// ---------------------------------------------------------------------------
// 教育費のマスタデータ
// ---------------------------------------------------------------------------

/**
 * 学校種別の学習費（`data/education/school-cost.json` の形）。
 *
 * domain 層は JSON を直接 import せず、この型で引数として受け取る。
 */
export type SchoolCostTable = {
  kindergarten: SchoolCostByType
  elementary: SchoolCostByType
  juniorHigh: SchoolCostByType
  highSchool: SchoolCostByType
}

/** 公立・私立それぞれの学習費 */
export type SchoolCostByType = {
  public: SchoolCostEntry
  private: SchoolCostEntry
}

/**
 * ある学校種・公私の1年あたりの学習費。
 *
 * **`supplementaryStudy`（補助学習費＝塾代）をこのアプリの計算に使わない。**
 * 塾は `Child.cramSchoolPeriods` として利用者が入力するため、
 * ここから足すと二重計上になる。統計値は画面に参考として出すためだけに持つ。
 */
export type SchoolCostEntry = {
  /** 学習費総額。内訳の合計であり、計算には使わない（参考値） */
  total: Yen
  /** 学校教育費（授業料・教材費・通学関係費など） */
  schoolEducation: Yen
  /** 学校給食費 */
  schoolLunch: Yen
  /** 学校外活動費（補助学習費 + その他）。参考値 */
  outsideActivity: Yen
  /** 補助学習費（塾・家庭教師・参考書）。**参考値。計算には使わない** */
  supplementaryStudy: Yen
  /** その他の学校外活動費（習い事・スポーツ・文化活動） */
  otherOutsideActivity: Yen
  /** 学年別の補助学習費。参考値 */
  supplementaryStudyByGrade?: readonly Yen[]
  /**
   * 学校教育費のうち授業料（高校だけ持つ）。**就学支援金を引いた後に保護者が払った額の平均**で、
   * 新しい計算（`domain/plan/bands/childCost.ts`）が授業料の標準額に置き換えるのに使う（支援金を二重に引かないため）。
   * 前の版の計算は読まない
   */
  tuitionPaid?: { amount: Yen; note: string }
}

/**
 * 児童手当のマスタデータ（`data/benefit/child-allowance.json` の形）。
 *
 * **金額・年齢区分・第3子加算の数え方をコードに直書きしない。**
 * 制度が変われば JSON を差し替えるだけで済むようにする。
 */
export type ChildAllowanceTable = {
  /** 年齢の区分ごとの月額。`fromAge` の昇順で持ち、先頭は 0 歳から始める */
  tiers: readonly ChildAllowanceTier[]
  /**
   * 支給が終わる年齢。**この年齢に達したあと最初の年度末まで**支給される。
   * 誕生日ではなく年度末で切れるため、早生まれかどうかで受給月数が変わる。
   */
  eligibilityEndAge: number
  /**
   * 第何子かを数えるときに含める子の上限年齢。
   * 数える対象は支給対象より広い（既に支給が終わった上の子も第1子として数える）ため、
   * `eligibilityEndAge` 以上でなければならない。
   */
  birthOrderCountUpToAge: number
  /** 所得制限があるか。撤廃されていれば false */
  hasIncomeLimit: boolean
}

/**
 * 児童手当の年齢区分1つぶん。
 * 区分は `fromAge` から次の区分の `fromAge` の直前までを受け持つ。
 */
export type ChildAllowanceTier = {
  /** 区分の下限年齢。**この年齢に達した月の翌月から**この区分の額になる */
  fromAge: number
  /** 第1子・第2子の月額 */
  monthlyAmount: Yen
  /** 第3子以降の月額 */
  monthlyAmountThirdOrLater: Yen
}

/**
 * 高等学校等就学支援金のマスタデータ（`data/benefit/high-school-support.json` の形）。
 *
 * **2026年4月1日施行の改正で、所得による支給制限と私立向けの加算が条文から消えた。**
 * 支給額は「授業料の月額」と「設置者・種類・課程ごとの支給限度額」の小さい方だけで決まる
 * （高等学校等就学支援金の支給に関する法律 第5条第1項）。
 * このため、就学支援金は**前年所得に依存しない**。`TaxBase` を参照しない。
 */
export type HighSchoolSupportTable = {
  /** 支給限度額（月額）。法第5条第1項の「政令で定める額」 */
  monthlyLimit: HighSchoolSupportByType
  /**
   * 標準的な授業料の年額。`Child.annualHighSchoolTuition` が null のときに使う。
   * 支給額は授業料が上限になるため、限度額だけでは足りない。
   */
  standardAnnualTuition: HighSchoolSupportByType
  /**
   * 支給を受けられる通算月数の上限（法第3条第2項第2号の「三十六月」）。
   * 全日制で3年通えばちょうど使い切る。
   */
  maxSupportedMonths: number
  /**
   * 所得による支給制限があるか。2026年4月改正で撤廃されていれば false。
   *
   * **true を渡すと例外になる。** このモジュールは所得判定を実装しておらず、
   * 制限のある制度データをそのまま計算すると受給額を上振れさせて黙って返すことになるため、
   * 静かに間違えるより落とす方を選んでいる。
   */
  hasIncomeLimit: boolean
}

/** 公立・私立それぞれの額。全日制を前提とする（定時制・通信制は対象外） */
export type HighSchoolSupportByType = {
  public: Yen
  private: Yen
}

/**
 * 幼児教育・保育の無償化のマスタデータ（`data/childcare/free-education.json` の形）。
 *
 * **自治体の保育料階層表はここに持たない。** 階層表は自治体ごとにファイルを分け、
 * 前年の市町村民税所得割額から引く（フェーズ2）。ここに置くのは全国共通の制度だけ。
 */
export type ChildcareTable = {
  /**
   * 保育料が無償になるクラス年齢。3歳児クラス（年少）からなら 3。
   *
   * **満年齢ではなくクラス年齢。** 満3歳の誕生日ではなく、
   * その年度の4月1日時点で何歳かで決まる。
   */
  freeFromClassAge: number
  /**
   * 無償化されたあとに実費徴収される**副食費**（おかず・おやつ）の月額の目安。
   *
   * `ChildcareEnrollment.monthlyExtraCostAfterFree` が `null` のときに、
   * 無償化前の実費へ上乗せする。
   *
   * **主食費（ごはん・パン）は含まない。** 国が目安を示しているのは副食費だけで、
   * 主食費は各施設が実費で定める（国の目安が存在しない。裏取り済み・2026-08-20）。
   * 主食費は `standardMonthlyStapleFoodCost` に分けて持つ。
   * 免除（低所得世帯・第3子以降）は反映しないので、その分だけ上振れる。
   * 園の実額（重要事項説明書に載る）が分かったら
   * `monthlyExtraCostAfterFree` に直接入力して上書きするのが確実。
   */
  standardMonthlySideDishCost: Yen
  /**
   * 無償化されたあとに実費徴収される**主食費**（ごはん・パン）の月額の既定値。
   * 副食費と同じく、`monthlyExtraCostAfterFree` が `null` のときに無償化前の実費へ上乗せする。
   *
   * **国の目安は存在しない**（こども家庭庁 自治体向けFAQ 12-46）ので、制度の値ではなく
   * アプリの判断値。出典と選び方は `data/childcare/mealFee.json` の `values.appDefault`。
   * 免除の対象外（免除されるのは副食費だけ）。
   */
  standardMonthlyStapleFoodCost: Yen
}

/** 大学の学費（`data/education/university-cost.json` の形） */
export type UniversityCostTable = {
  nationalPublic: UniversityCostEntry
  privateHumanities: UniversityCostEntry
  privateScience: UniversityCostEntry
  privateMedical: UniversityCostEntry
}

/** ある進路の大学費用 */
export type UniversityCostEntry = {
  /** 入学料 */
  admissionFee: Yen
  /** 初年度に納める総額（入学料を含む） */
  initialYear: Yen
  /** 2年目以降の年額 */
  annual: Yen
  /** 修業年限。医歯系は6年 */
  years: number
}

// ---------------------------------------------------------------------------
// 税のマスタデータ
// ---------------------------------------------------------------------------

/**
 * 所得税額に上乗せする付加税1本ぶん（復興特別所得税・防衛特別所得税）。
 * **課税標準は所得税額。** 期限の異なる付加税が並走するので配列で持つ。2027年分からは
 * 復興特別所得税が 1.1%（2047年分まで）に下がり、防衛特別所得税 1%（終期未定）が
 * 新設されて2本になる（令和8年法律第12号。合計 2.1% は据え置き）。
 *
 * `fromYear ≤ 譲渡年` かつ `譲渡年 ≤ untilYear`（null は終期未定＝上限なし）のとき適用する。
 */
export type IncomeSurtax = {
  /** 名称（復興特別所得税など）。計算には使わず、内訳表示と出典の対応づけに使う */
  name: string
  /** 所得税額に対する割合 */
  rate: Rate
  /** この年の譲渡から適用する */
  fromYear: Year
  /** この年の譲渡まで適用する。法文上の終期が無い（「当分の間」）なら null */
  untilYear: Year | null
}

/**
 * 年分（または年度）で切り替わる表の 1 段の適用期間（D25）。
 *
 * 税制は「令和 7 年分だけ」「令和 8〜9 年分」「令和 10 年分以後」のように段で変わるため、
 * 現在の 1 本ではなく全期間を `schedule[]` で持ち、計算側が年で 1 段を引く。
 * `untilYear` が null は終期未定（改正されるまで続く）。
 */
export type YearRange = {
  fromYear: Year
  untilYear: Year | null
}

/** 「金額が `upTo` 以下なら `rate` と `deduction`」の 1 行。`upTo` が null は上限なし */
export type RateBand = {
  upTo: Yen | null
  rate: Rate
  deduction: Yen
}

/** 「合計所得金額が `totalIncomeUpTo` 以下なら `amount`」の 1 行。null は上限なし */
export type IncomeBandAmount = {
  totalIncomeUpTo: Yen | null
  amount: Yen
}

/** 「所得が `totalIncomeOver` 超 `totalIncomeUpTo` 以下なら `amount`」の 1 行 */
export type IncomeRangeAmount = {
  totalIncomeOver: Yen
  totalIncomeUpTo: Yen | null
  amount: Yen
}

/** 配偶者・扶養親族と認められる所得の上限（年分で変わる） */
export type DependentIncomeRequirement = YearRange & {
  totalIncomeUpTo: Yen
}

/** 給与所得控除の 1 段（年分ごと） */
export type EmploymentIncomeDeductionSchedule = YearRange & {
  /** 最低保障額。式の結果がこれを下回るときはこの額 */
  minimum: Yen
  /** 収入金額が `upTo` 以下のとき「収入金額 × rate + deduction」 */
  table: readonly RateBand[]
  /**
   * 低所得層の特例（租税特別措置法第 29 条の 4 第 2 項。2026〜2027 年分）。
   * 収入金額が `incomeFrom` 以上 `incomeBelow` 未満なら、表によらず給与所得の金額そのものを決める。
   * `employmentIncome` が null の行は「収入金額 − 最低保障額」
   */
  specialRulesForLowIncome?: {
    rows: readonly {
      incomeFrom: Yen
      incomeBelow: Yen
      employmentIncome: Yen | null
    }[]
  }
}

/** 配偶者控除の 1 行（納税者本人の合計所得金額の帯ごと） */
export type SpouseDeductionRow = {
  taxpayerTotalIncomeUpTo: Yen
  general: Yen
  elderly: Yen
}

/** 配偶者特別控除の 1 行（配偶者の所得の帯 × 納税者本人の所得の帯） */
export type SpouseSpecialDeductionRow = {
  spouseTotalIncomeOver: Yen
  spouseTotalIncomeUpTo: Yen
  amountsByTaxpayerIncome: readonly { taxpayerTotalIncomeUpTo: Yen; amount: Yen }[]
}

/**
 * 所得税のマスタデータ（`data/tax/income-tax.json` の `values` の形）。
 *
 * 総合課税（給与・事業・不動産・雑）の所得税。速算表は 2015 年分から変わっていないが、
 * 給与所得控除・基礎控除・配偶者と扶養の所得要件は 2025 年分から 2 年続けて改正され、
 * 年分ごとに表が違う。それぞれ `schedule[]` で全期間を持つ。
 */
export type IncomeTaxTable = {
  /** 速算表。課税所得が `upTo` 以下のとき「課税所得 × rate − deduction」 */
  brackets: readonly RateBand[]
  bracketsMeta: {
    /** 課税所得をこの単位で切り捨ててから速算表に掛ける（1,000 円） */
    taxableIncomeRoundDownTo: number
  }
  employmentIncomeDeduction: {
    schedule: readonly EmploymentIncomeDeductionSchedule[]
  }
  basicDeduction: {
    schedule: readonly (YearRange & { table: readonly IncomeBandAmount[] })[]
  }
  spouseDeduction: {
    ordinary: {
      table: readonly SpouseDeductionRow[]
      /** 老人控除対象配偶者になる年齢（その年 12 月 31 日時点） */
      elderlyFromAge: number
      spouseIncomeRequirement: { schedule: readonly DependentIncomeRequirement[] }
    }
    special: {
      schedule: readonly (YearRange & { table: readonly SpouseSpecialDeductionRow[] })[]
    }
  }
  dependentDeduction: {
    amounts: {
      general: Yen
      specific: Yen
      elderly: Yen
      elderlyCohabitingParent: Yen
    }
    ages: {
      /** 控除対象扶養親族になる年齢（この歳以上。年齢はその年 12 月 31 日時点） */
      controlledDependentFromAge: number
      specificFromAge: number
      /** この歳未満まで特定扶養親族 */
      specificBelowAge: number
      elderlyFromAge: number
    }
    dependentIncomeRequirement: { schedule: readonly DependentIncomeRequirement[] }
  }
  /** 特定親族特別控除（19 歳以上 23 歳未満で扶養控除の所得要件を超えた親族。2025 年分から） */
  specifiedRelativeSpecialDeduction: {
    schedule: readonly (YearRange & { table: readonly IncomeRangeAmount[] })[]
  }
  /**
   * 青色申告特別控除。不動産所得 → 事業所得の順に、黒字の範囲まで引く（租税特別措置法第 25 条の 2）。
   * 白色申告と雑所得（副業）には無い
   */
  blueReturnDeduction: {
    blue65: Yen
    blue55: Yen
    blue10: Yen
    /** true なら控除額は所得の金額が限度（控除で赤字を作れない） */
    limitedToIncome: boolean
  }
  socialInsuranceDeduction: {
    /** 支払った社会保険料のうち控除できる割合（全額なら 1） */
    deductibleRatio: Rate
  }
  /** 所得税額に上乗せする付加税 */
  surtaxes: readonly IncomeSurtax[]
}

/** 標準報酬月額の等級。報酬月額が `from` 以上 `to` 未満なら `standardMonthly`。`to` が null は上限なし */
export type StandardRemunerationGrade = {
  grade: number
  standardMonthly: Yen
  from: Yen
  to: Yen | null
}

/**
 * 被用者（会社員）の社会保険料のマスタデータ（`data/tax/social-insurance.json` の `values` の形）。
 *
 * 健康保険・介護保険・子ども・子育て支援金・厚生年金は標準報酬月額（等級表で丸めた額）と
 * 標準賞与額に料率を掛けて労使折半する。雇用保険だけは等級表を使わず賃金に直接掛ける。
 * 健康保険の料率は都道府県支部ごとに違う（`ratesByPrefecture`。介護保険・子ども・子育て支援金は全国一律）。
 */
export type SocialInsuranceTable = {
  healthInsurance: {
    /** この料率が適用される年度。これより前の年は計算できない */
    fiscalYear: Year
    /** 都道府県支部ごとの健康保険料率。キーは都道府県コード（"01"〜"47"） */
    ratesByPrefecture: Readonly<Record<string, Rate>>
    /**
     * アプリの仮置き（制度の数値ではない）。`ratesByPrefecture` に無い県の住所（見本の架空のコードなど）を、
     * どの県の料率で概算するか。国保の代わりの市の県にそろえる
     */
    appDefault: { fallbackPrefectureCode: string }
    employeeShare: Rate
    longTermCareRate: Rate
    /** 介護保険の第 2 号被保険者になる年齢（この歳以上） */
    longTermCareAgeFrom: number
    /** この歳まで（含む） */
    longTermCareAgeTo: number
    childRearingSupportRate: Rate
    childRearingSupportEmployeeShare: Rate
    /** 年度内の標準賞与額の累計の上限（健保・介護・支援金に共通） */
    bonusCapPerFiscalYear: Yen
    /** 標準賞与額はこの単位で切り捨てる */
    bonusRoundDownUnit: number
    grades: readonly StandardRemunerationGrade[]
  }
  pension: {
    rate: Rate
    employeeShare: Rate
    /** 支給 1 回あたりの標準賞与額の上限 */
    bonusCapPerMonth: Yen
    bonusRoundDownUnit: number
    grades: {
      schedule: readonly {
        /** "YYYY-MM"。この月から */
        fromMonth: string
        /** "YYYY-MM"。この月まで（含む）。null は終期未定 */
        untilMonth: string | null
        maxStandardMonthly: Yen
        grades: readonly StandardRemunerationGrade[]
      }[]
    }
    /**
     * 上限額だけが決まっている将来の引き上げ（等級の範囲は政令待ち）。
     * 計算側は健保の等級表をこの上限で頭打ちにして代用する
     */
    upperLimitSchedule: readonly { fromMonth: string; maxStandardMonthly: Yen }[]
  }
  employmentInsurance: {
    schedule: readonly {
      fiscalYear: Year
      businessType: string
      employeeRate: Rate
    }[]
    /** 事業の種類を指定しないときに使う `businessType` */
    defaultBusinessType: string
  }
}

/** 市町村民税・道府県民税の内訳（率または額） */
export type ResidentTaxSplit = {
  municipal: number
  prefectural: number
}

/**
 * 個人住民税のマスタデータ（`data/tax/resident-tax.json` の `values` の形）。
 *
 * 住民税は前年の所得に対して翌年度に課税される。控除額は所得税と違う（基礎控除 43 万円など）。
 * 税率は標準 6% + 4% だが、指定都市では 8% + 2%（合計は同じ 10%）。県・市の超過課税（均等割や所得割への上乗せ）は
 * `municipalities` の各エントリに織り込み済みの率と額で持つ。
 */
export type ResidentTaxTable = {
  taxation: {
    /** 課税所得をこの単位で切り捨ててから税率を掛ける（地方税法第 20 条の 4 の 2 第 1 項。1,000 円） */
    taxableIncomeRoundDownTo: number
  }
  incomeLevy: {
    standard: ResidentTaxSplit
    designatedCity: ResidentTaxSplit
  }
  perCapitaLevy: {
    standard: ResidentTaxSplit
    forestEnvironmentTax: { amount: Yen; fromFiscalYear: Year }
  }
  /** 裏取り済みの自治体。ここに無い自治体は標準税率・超過課税なしで計算する */
  municipalities: Readonly<
    Record<
      MunicipalityCode,
      {
        designatedCity: boolean
        /** 超過課税を織り込んだ所得割の率 */
        incomeLevyRate: ResidentTaxSplit
        /** 超過課税を織り込んだ均等割の額（森林環境税は別） */
        perCapitaLevy: ResidentTaxSplit & { forestEnvironmentTax: Yen }
      }
    >
  >
  incomeRequirements: {
    sameHouseholdSpouseTotalIncomeUpTo: Yen
    dependentTotalIncomeUpTo: Yen
    /** 配偶者控除・配偶者特別控除を受けられる納税者本人の合計所得の上限 */
    deductibleSpousePayerIncomeUpTo: Yen
    specifiedRelativeTotalIncomeUpTo: Yen
    /** この年度分から適用。これより前の年度は計算できない */
    fromFiscalYear: Year
  }
  basicDeduction: { table: readonly IncomeBandAmount[] }
  spouseDeduction: {
    table: readonly { payerTotalIncomeUpTo: Yen; amount: Yen; elderlyAmount: Yen }[]
    elderlyAgeFrom: number
    spouseTotalIncomeUpTo: Yen
  }
  spouseSpecialDeduction: {
    payerTotalIncomeUpTo: Yen
    /** `table[].amounts` の並びに対応する納税者本人の合計所得の上限 */
    payerBrackets: readonly Yen[]
    table: readonly {
      spouseTotalIncomeOver: Yen
      spouseTotalIncomeUpTo: Yen | null
      amounts: readonly Yen[]
    }[]
  }
  dependentDeduction: {
    general: Yen
    specific: Yen
    elderly: Yen
    elderlyCohabitingLinealAscendant: Yen
    ages: {
      controlledDependentFromAge: number
      specificFromAge: number
      specificBelowAge: number
      elderlyFromAge: number
    }
    dependentTotalIncomeUpTo: Yen
  }
  specifiedRelativeSpecialDeduction: {
    /** この年度分から適用（2026 年度分から）。それより前の年度は控除なし */
    fromFiscalYear: Year
    relativeAgeFrom: number
    relativeAgeUnder: number
    table: readonly {
      relativeTotalIncomeOver: Yen
      relativeTotalIncomeUpTo: Yen | null
      amount: Yen
    }[]
  }
  /** 調整控除（所得税と住民税の人的控除の差から生じる負担増を戻す税額控除） */
  adjustmentCredit: {
    applicableTotalIncomeUpTo: Yen
    taxableIncomeThreshold: Yen
    rates: {
      standard: ResidentTaxSplit
      designatedCity: ResidentTaxSplit
    }
    minimumBaseAboveThreshold: Yen
    personalDeductionDifference: {
      basic: Yen
      deductibleSpouse: {
        payerIncomeUpTo9000000: Yen
        payerIncomeUpTo9500000: Yen
        payerIncomeUpTo10000000: Yen
      }
      elderlyDeductibleSpouse: {
        payerIncomeUpTo9000000: Yen
        payerIncomeUpTo9500000: Yen
        payerIncomeUpTo10000000: Yen
      }
      dependentGeneral: Yen
      dependentSpecific: Yen
      dependentElderly: Yen
      dependentElderlyCohabitingLinealAscendant: Yen
    }
  }
  /** 非課税限度額。均等割と所得割で加算額が違う */
  nonTaxableThreshold: {
    levelClassCoefficient: number
    perCapita: {
      base: Yen
      flatAddition: Yen
      dependentAddition: Yen
    }
    incomeLevy: {
      base: Yen
      flatAddition: Yen
      dependentAddition: Yen
    }
  }
  /** 保育料の階層判定に使う市町村民税所得割額の求め方（指定都市でも 6% で計算し直す） */
  childcareLevyBasis: {
    rate: Rate
    afterAdjustmentCredit: boolean
    beforeTaxCredits: boolean
  }
}

/** 国民健康保険料の 1 区分（医療分・支援分・介護分・子ども分）の料率と額 */
export type NationalHealthInsuranceSegmentRates = {
  /** 所得割の料率。賦課基準額（前年の総所得金額等 − 住民税の基礎控除）に掛ける */
  incomeRate: Rate
  /** 均等割（加入者 1 人あたりの年額） */
  perCapita: Yen
  /**
   * 平等割（世帯別平等割。1 世帯あたりの年額）。平等割の無い区分・自治体は 0。
   * 低所得世帯の 7・5・2 割の軽減は掛かるが、未就学児・こどもの軽減は掛からない（国民健康保険法施行令第 29 条の 7 第 6 項）
   */
  perHousehold: Yen
  /** 賦課限度額（世帯単位・区分ごとの年額の上限） */
  cap: Yen
}

/**
 * 国民健康保険料の端数の処理（市の条例で決まる）。項目を省くと、その段は円単位の四捨五入で概算する
 * （条例を確かめていない市の扱い。差は年に数百円）。値の意味は計算側（`domain/tax/nationalInsurance.ts`）で読み、
 * 下に書いた以外の値は例外にする。
 */
export type NationalHealthInsuranceRounding = {
  /**
   * 所得割の 1 円未満。`floor`＝世帯の合計で切り捨て／`perMemberFloor`＝加入者ごとに切り捨ててから足す
   */
  incomeLevy?: string
  /** 低所得世帯の 7・5・2 割の軽減額（均等割・平等割それぞれ）の 1 円未満。`ceil`＝切り上げ */
  reductionAmount?: string
  /** 区分ごとの保険料（賦課限度額を掛けた後）をこの単位未満で切り捨てる（10・100 など） */
  segmentPremiumFloorUnit?: number
}

/** 低所得世帯の均等割の軽減 1 段（判定所得 ≦ base + perMember × 加入者数 + 給与所得者等の加算） */
export type NationalHealthInsuranceReductionTier = {
  base: Yen
  perMember: Yen
  /** 軽減する割合（7 割軽減なら 0.7） */
  rate: Rate
}

/**
 * 国民健康保険料・国民年金保険料のマスタデータ（`data/tax/national-insurance.json` の `values` の形）。
 *
 * 国保は**世帯単位・前年の所得**で決まり、2026 年度から医療・支援・介護・子どもの 4 区分。料率は自治体ごとに違い、
 * 全国共通の標準料率は無い（住民税と違って、表に無い自治体は計算できない）。
 * 国民年金は第 1 号被保険者 1 人あたりの定額。
 */
export type NationalInsuranceTable = {
  nationalHealthInsurance: {
    /** 国保の被保険者でいられる年齢（この歳未満。以後は後期高齢者医療制度） */
    insuredAge: { under: number }
    /** 賦課基準額を出すときに引く住民税の基礎控除。前年の合計所得金額が `maxTotalIncome` 以下の最初の行 */
    basicDeductionSchedule: readonly { maxTotalIncome: Yen | null; amount: Yen }[]
    /** 介護分の対象年齢（from 以上 to 以下） */
    longTermCareAgeRange: { from: number; to: number }
    /**
     * アプリの仮置き（制度の数値ではない）。料率が表に無い自治体を、どの自治体の料率で概算するか。
     * null なら概算せず例外にする。概算したことは警告 `nationalHealthInsuranceApproximated` で知らせる
     */
    appDefault: { fallbackMunicipalityCode: MunicipalityCode | null }
    byMunicipality: Readonly<
      Record<
        MunicipalityCode,
        {
          /** この料率の年度。これより前の年度は計算できず、後の年度はこの値を延ばす */
          fiscalYear: Year
          /**
           * 平等割のある自治体か。false なのにどれかの区分の `perHousehold` が 0 でない表は、
           * 表の中で食い違っているので計算側が例外にする
           */
          hasPerHousehold: boolean
          /** 保険料の端数の処理（市の条例による）。無い自治体は円単位の四捨五入で概算する */
          rounding?: NationalHealthInsuranceRounding
          medical: NationalHealthInsuranceSegmentRates
          support: NationalHealthInsuranceSegmentRates
          longTermCare: NationalHealthInsuranceSegmentRates
          childcare: NationalHealthInsuranceSegmentRates & {
            /** 18 歳以上の加入者だけに乗る追加の均等割（こどもの軽減分の財源） */
            perCapitaAge18Plus: Yen
            /** こどもの均等割を軽減する割合（全額なら 1） */
            childPerCapitaReduction: Rate
            /** 「こども」とみなす年度末（翌年 3 月 31 日）時点の年齢の上限（この歳以下） */
            childMaxAgeAtFiscalYearEnd: number
          }
          /** 子のいる世帯の賦課基準額から引く自治体独自の控除。無い自治体は null */
          municipalDeduction: {
            under16PerPerson: Yen
            age16To18PerPerson: Yen
            /** 対象の子の前年の合計所得金額の上限（以下） */
            childIncomeLimit: Yen
            /**
             * 年齢の区切りと基準日。`asOf` は `previousDecember31`（保険料の年度の前年 12 月 31 日時点）だけに対応し、
             * それ以外の値は計算側が例外にする
             */
            ages: { under16BelowAge: number; age16To18BelowAge: number; asOf: string }
            /**
             * 誰の賦課基準額から引くか。`highestBaseMember`（世帯の加入者のうち賦課基準額が最も高い人）か
             * `insuredHouseholder`（加入者である世帯主。世帯主が加入者でなければ控除しない）。それ以外の値は計算側が例外にする
             */
            deductFrom: string
          } | null
        }
      >
    >
    reduction: {
      schedule: readonly {
        fiscalYear: Year
        /** 給与所得者等が 2 人以上のとき、(人数 − 1) に掛けて判定額に足す額 */
        salaryEarnerAddition: Yen
        seventy: NationalHealthInsuranceReductionTier
        fifty: NationalHealthInsuranceReductionTier
        twenty: NationalHealthInsuranceReductionTier
      }[]
      /**
       * 軽減判定の「給与所得者等」に当たる収入の基準。いずれも「この額を超える」が条件。
       * 公的年金は `pensionAgeBoundary` 歳未満か以上かで基準が違う
       */
      salaryEarnerThresholds: {
        employmentRevenueOver: Yen
        pensionRevenueOverUnder65: Yen
        pensionRevenueOverAge65Plus: Yen
        pensionAgeBoundary: number
      }
      /** 未就学児の均等割を軽減する割合（所得による軽減の後にさらに掛ける） */
      preschoolPerCapitaReduction: Rate
      /** 未就学児とみなす年度末（翌年 3 月 31 日）時点の年齢の上限（この歳以下） */
      preschoolMaxAgeAtFiscalYearEnd: number
    }
  }
  nationalPension: {
    /** 年度ごとの月額。表より後の年度は最新の額を延ばす */
    schedule: readonly { fiscalYear: Year; monthly: Yen }[]
    /** 第 1 号被保険者の年齢（from 以上 under 未満） */
    insuredAge: { from: number; under: number }
  }
}

/**
 * 老後の設定。
 *
 * **退職金と年金は世帯合計で持たない。**
 * 会社員と個人事業主では退職金の有無が違い、年金も加入歴で額が変わる。
 * 受給開始年齢も繰上げ・繰下げで人ごとに違うため、合計してしまうと
 * 「片方が先に受給を始める数年間」を表せない。
 *
 * 老後資金の目標額はここには持たない（新しい版では老後資金のカードが持つ）。
 */
export type RetirementPlan = {
  /** 世帯員ごとの退職金と年金。`Person.id` に対応する */
  byPerson: readonly PersonRetirement[]
}

/** 世帯員1人ぶんの老後の収入 */
export type PersonRetirement = {
  personId: PersonId
  /** 退職金。個人事業主など受け取らない人は 0 */
  severancePay: Yen
  /** 退職金を受け取る年。null なら `Person.retirementAge` に達した年 */
  severanceYear: Year | null
  /** 公的年金の受給開始年齢。繰上げ・繰下げを表せるよう人ごとに持つ */
  pensionStartAge: number
  /**
   * 公的年金の年額。ねんきん定期便の数値を入れる。
   *
   * **起点年の物価での額として扱う。** 定期便の見込み額は今の物価で書かれており、
   * 実際の年金は毎年の改定で物価・賃金にほぼ追随する。名目固定で 40 年先まで置くと
   * 生活費だけが逓増して老後資金の目標額が桁違いに膨らむ（2026-09-05）。
   * 起点年からは `Assumptions.pensionIndexationRate` で毎年伸ばす。
   */
  annualPension: Yen
}

// ---------------------------------------------------------------------------
// 積立（`goal/savings.ts`。前の版の目標と積立の型のうち、残した計算が使う物だけ）
// ---------------------------------------------------------------------------

/**
 * 家計からの積立を「この年までは自分で決めた額」にする段階（D29 案 1・SPEC §2.13）。
 *
 * 収入が低い年に定額を要求されないよう、利用者が「2027 年までは月 8 万」のように手で置く。
 * 段階は `untilYear` の昇順に並べ、前の段階の翌年（最初は家計からの積立の開始年）からその年までを
 * `annualAmount` で積む。**最後の段階の翌年から使う年の前年まで**が定額 c で解かれる年になる。
 *
 * 段階の額だけで目標額を超えるのは矛盾（例外）。順方向シミュレーションは段階の額をそのまま積むので、
 * 受け入れると超過分が副業の必要額に乗ってしまう。
 */
export type SavingsStage = {
  /** この年まで（この年を含む）。家計からの積立の開始年以上、使う年の 2 年前以下 */
  untilYear: Year
  /** その期間に家計から毎年積む額 */
  annualAmount: Yen
}

// ---------------------------------------------------------------------------
// 税の入口が読む世帯の設定
// ---------------------------------------------------------------------------

/**
 * 健康保険と年金の入り方のうち、収入からは決まらないもの。
 *
 * 収入から決まるものは計算側が年ごとに判定する（`domain/tax/household.ts`）：その年に給与がある大人は会社の健康保険と
 * 厚生年金、それ以外の大人は国民健康保険（75 歳未満）と国民年金（20〜59 歳）。子は、会社員の大人がいる年はその扶養、
 * いない年は国保の加入者。
 */
export type InsurancePlan = {
  /**
   * 会社員の家族の扶養（健康保険の被扶養者・国民年金の第 3 号被保険者）に入る大人。国保と国民年金を納めない。
   *
   * **扶養に入れるかは計算側で判定しない**（収入の基準は保険者ごとに運用が違う）。利用者の申告を信じ、
   * その年に会社員の大人が他にいるときだけ効く（いなければ国保に戻る）。本人に給与がある年は会社の保険が優先する
   */
  dependentAdultIds: readonly PersonId[]
  /**
   * 国保の世帯主。国保は世帯主に請求が来て、世帯主の所得は加入者でなくても軽減の判定に入る。
   * null なら `adults` の先頭の人
   */
  nationalHealthInsuranceHouseholderId: PersonId | null
}

/**
 * 制度のマスタデータの束。`data/` の各 JSON の `values` をまとめて渡す。
 *
 * 入力（`LifePlan`）と分けているのは、入力は世帯ごとに変わるが
 * マスタデータは全世帯で共通なため。localStorage に保存するのは入力だけでよい。
 */
export type MasterTables = {
  childAllowance: ChildAllowanceTable
  highSchoolSupport: HighSchoolSupportTable
  childcare: ChildcareTable
  schoolCost: SchoolCostTable
  universityCost: UniversityCostTable
  /** 税・社会保険。`domain/tax/` が使う */
  incomeTax: IncomeTaxTable
  socialInsurance: SocialInsuranceTable
  residentTax: ResidentTaxTable
  /** 個人事業主などの国民健康保険料・国民年金保険料 */
  nationalInsurance: NationalInsuranceTable
}

// ---------------------------------------------------------------------------
// 中間状態
// ---------------------------------------------------------------------------

/**
 * 人的控除（配偶者控除・扶養控除・特定親族特別控除）を決めるための、納税者から見た家族の情報。
 *
 * 所得税と住民税で控除額は違うが、判定に使う材料（年齢と所得）は同じなので 1 つの型で渡す。
 * 年齢はその年 12 月 31 日時点、所得はその年の合計所得金額。
 * これを組み立てるのは呼び出し側（`tax/household.ts`）の責務。
 */
export type PersonalDeductionContext = {
  /** 配偶者。いなければ null */
  spouse: { totalIncome: Yen; age: number } | null
  /** 配偶者以外の生計を一にする親族（子・親など）。所得要件を超える人も含めてよい（控除の判定はこちらで行う） */
  dependents: readonly DependentRelative[]
}

/** 扶養親族の候補 1 人 */
export type DependentRelative = {
  age: number
  totalIncome: Yen
  /** 同居する直系尊属（親・祖父母）か。70 歳以上のとき同居老親等の控除額になる。省略は false */
  cohabitingLinealAscendant?: boolean
}

/**
 * ある年の所得情報。**翌年の住民税・国民健康保険料・保育料の算定に使う。**
 *
 * これらは前年の所得で決まるため、年ループで1年ぶん持ち回る必要がある。
 * 事業を立ち上げている世帯では、この1年のずれが資金繰りに効く（SPEC §2.4）。
 */
export type TaxBase = {
  year: Year
  /** 世帯員ごとの総所得金額等。翌年度の国民健康保険料の所得割と軽減判定に使う */
  totalIncomeByPerson: ReadonlyMap<PersonId, Yen>
  /** 世帯員ごとの、この年の所得に対して翌年度に課される住民税。翌年の手取りから引く */
  residentTaxNextFiscalYearByPerson: ReadonlyMap<PersonId, Yen>
  /** 世帯合計の市町村民税所得割額（保育料用の 6% 換算）。保育料の階層を引くのに使う */
  municipalTaxIncomeLevy: Yen
}

// ---------------------------------------------------------------------------
// 積立線（`goal/savings.ts` の段階積立が返す形）
// ---------------------------------------------------------------------------

/** 積立線の1年ぶん */
export type GoalSchedule = {
  year: Year
  /** 家計からの積立額 */
  contribution: Yen
  /** 児童手当から回した額 */
  earmarked: Yen
  /** その年末に貯まっているべき額（目標額が上限） */
  required: Yen
}

// ---------------------------------------------------------------------------
// 世帯収入の内訳（`income/household.ts`）
// ---------------------------------------------------------------------------

/**
 * 世帯員 1 人ぶんの本業（副業を除く）を種類ごとに分けたもの。
 *
 * 家賃収入は物件の所有者に付くが、本人の働きで稼ぐ額ではないので給与・事業と分けて持つ
 * （「本業がいくらで、目標としていくら稼げるようになるべきか」を読むため）
 */
export type PersonPrimaryIncome = {
  personId: PersonId
  /** 給与の額面（賞与込み） */
  employment: Yen
  /** 事業所得 */
  business: Yen
  /** 不動産所得（家賃収入 − 経費、持分適用後） */
  realEstate: Yen
  /** 上 3 つの合計 */
  amount: Yen
}

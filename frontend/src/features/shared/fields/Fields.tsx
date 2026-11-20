/**
 * 新しい画面の入力欄の部品（SPEC §7「`features/input/fields/` は `shared/` へ移して使う」）。
 *
 * 前の版の部品（`features/input/fields/Fields.tsx`。T13 で消した。タグ `v1-final` にある）は前の版のフォームの型（`PlanForm`）と React Hook Form に結びついていたので、
 * 文字列と数値の仲立ちのやり方（入力中の文字列は部品が持ち、読めた数値だけを外へ渡す）と `parseNumber` を引き継いで、
 * 値と `onChange` を受け取るだけの形に書き直した。
 *
 * - 値は domain と同じ単位（円・小数の割合）で受け取り、見せるときだけ万円や % に直す
 * - 読めない・範囲の外の入力は、外へ渡さずに欄の下に理由を出す（保存の前に止める）
 * - `touched` が false の欄は「既定値のまま」として見分けられるようにする（`is-default`）
 */

import { memo, useId, useState, type ReactNode } from 'react'
import type { Month, YearMonth } from '../../../domain/plan/types'
import { describeMunicipality, municipalityOptions, resolveMunicipality } from '../municipality'
import { parseNumber } from './parseNumber'

/** 円 → 万円の割り算の数 */
const YEN_PER_MAN = 10000

/** 割合 → % の掛け算の数 */
const PERCENT = 100

/** 月の選択肢（1〜12） */
const MONTHS: readonly Month[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** どの欄にもある項目 */
type BaseProps = {
  label: string
  /** 直した欄か。false なら既定値のまま */
  touched: boolean
  /** 欄の外で見つかった問題（年が逆など）。あれば欄の下に出す */
  issue?: string | null
}

/** ラベル・入力・理由の枠。既定値のままの欄には `is-default` を付ける */
function FieldRow({
  id,
  label,
  touched,
  error,
  note,
  children,
}: {
  id: string
  label: string
  touched: boolean
  error: string | null
  /** 欄の下に出す短い補足（自治体の名前など） */
  note?: string | null
  children: ReactNode
}) {
  const className = ['field', touched ? 'is-touched' : 'is-default', error ? 'has-error' : null]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={className} data-touched={touched}>
      <label className="field__label" htmlFor={id}>
        {label}
        {touched ? null : <span className="visually-hidden">（既定値のまま）</span>}
      </label>
      <span className="field__control">{children}</span>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : note ? (
        <p className="field__note">{note}</p>
      ) : null}
    </div>
  )
}

/** 数値の欄の決まり（単位の換算と、受け付ける範囲） */
type NumberRule = {
  /** 値 → 見せる数 */
  toDisplay: (value: number) => number
  /** 見せる数 → 値（丸めもここで） */
  fromDisplay: (shown: number) => number
  /** 受け付けない値なら理由を返す */
  check: (value: number) => string | null
  /** 桁区切りを付けるか（年・年齢には付けない） */
  grouping: boolean
  /** スマホのキーボード。小数を入れる欄は decimal */
  inputMode: 'decimal' | 'numeric'
}

/**
 * 数値の入力。入力中の文字列（"12." など途中の状態）は部品が持ち、読めて範囲に入った値だけを `onChange` に渡す。
 * 外から値が変わったとき（行を足す・型を替える）は、表示を作り直す
 */
function NumberField({
  label,
  touched,
  issue,
  value,
  onChange,
  unit,
  rule,
  note,
}: BaseProps & {
  value: number
  onChange: (value: number) => void
  unit: string
  rule: NumberRule
  /** 欄の下に出す短い補足（既定値の出どころなど） */
  note?: string | null
}) {
  const id = useId()
  const [text, setText] = useState(() => formatForEdit(value, rule))
  const [error, setError] = useState<string | null>(null)
  // 自分が最後に外へ渡した値。これと違う値が来たら、外から変えられたということ
  const [synced, setSynced] = useState(value)
  if (!Object.is(value, synced)) {
    // 描画の途中で前回の値と比べて作り直す（effect で setState すると描画が二重になる）
    setSynced(value)
    setText(formatForEdit(value, rule))
    setError(null)
  }

  return (
    <FieldRow id={id} label={label} touched={touched} error={error ?? issue ?? null} note={note}>
      <input
        id={id}
        type="text"
        inputMode={rule.inputMode}
        className="field__input field__input--number"
        value={text}
        aria-invalid={error !== null || Boolean(issue)}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const parsed = parseNumber(next)
          if (parsed === null) {
            setError('数を入れてください')
            return
          }
          const converted = rule.fromDisplay(parsed)
          const problem = rule.check(converted)
          if (problem !== null) {
            setError(problem)
            return
          }
          setError(null)
          setSynced(converted)
          onChange(converted)
        }}
        onBlur={() => {
          // 入力を終えたら、読めている値を "1,200" のように整えて見せる（読めない入力はそのまま残して直してもらう）
          if (error === null) setText(formatForEdit(value, rule))
        }}
      />
      <span className="field__unit">{unit}</span>
    </FieldRow>
  )
}

/** 値を入力欄の文字列にする */
function formatForEdit(value: number, rule: NumberRule): string {
  if (!Number.isFinite(value)) return ''
  const shown = rule.toDisplay(value)
  // 小数は 4 桁まで（0.015 = 1.5% のような値を丸めすぎない）
  return Number(shown.toFixed(4)).toLocaleString('ja-JP', {
    maximumFractionDigits: 4,
    useGrouping: rule.grouping,
  })
}

/** 金額の欄の決まり。値は円の整数、見せるのは万円。負の数は受け付けない */
const MONEY_RULE: NumberRule = {
  toDisplay: (yen) => yen / YEN_PER_MAN,
  fromDisplay: (man) => Math.round(man * YEN_PER_MAN),
  check: (yen) => (yen < 0 ? '0 以上にしてください' : null),
  grouping: true,
  inputMode: 'decimal',
}

/** 金額（円）。万円で入れて見せる */
export function MoneyField(
  props: BaseProps & { value: number; onChange: (yen: number) => void; perMonth?: boolean },
) {
  const { perMonth, ...rest } = props
  return <NumberField {...rest} unit={perMonth ? '万円/月' : '万円'} rule={MONEY_RULE} />
}

/** 割合の欄の決まり。値は小数、見せるのは %。−100% 以下は計算できないので受け付けない */
const RATE_RULE: NumberRule = {
  toDisplay: (rate) => rate * PERCENT,
  fromDisplay: (percent) => percent / PERCENT,
  check: (rate) => (rate <= -1 ? '−100% より大きくしてください' : null),
  grouping: false,
  inputMode: 'decimal',
}

/** 割合（%） */
export function RateField(
  props: BaseProps & {
    value: number
    onChange: (rate: number) => void
    unit?: string
    note?: string | null
  },
) {
  const { unit, ...rest } = props
  return <NumberField {...rest} unit={unit ?? '%'} rule={RATE_RULE} />
}

/** 整数（年・年齢）。範囲の外は受け付けない */
export function IntegerField(
  props: BaseProps & {
    value: number
    onChange: (value: number) => void
    unit: string
    min: number
    max: number
  },
) {
  const { min, max, ...rest } = props
  const rule: NumberRule = {
    toDisplay: (value) => value,
    fromDisplay: (value) => value,
    check: (value) =>
      !Number.isInteger(value)
        ? '整数で入れてください'
        : value < min || value > max
          ? `${min}〜${max} にしてください`
          : null,
    grouping: false,
    inputMode: 'numeric',
  }
  return <NumberField {...rest} rule={rule} />
}

/**
 * 年月（年の数字と月の選択）。どちらかを直すと 1 つの年月として渡す。
 * 年の範囲の外は受け付けない
 */
export function YearMonthField({
  label,
  touched,
  issue,
  value,
  onChange,
  minYear,
  maxYear,
}: BaseProps & {
  value: YearMonth
  onChange: (value: YearMonth) => void
  minYear: number
  maxYear: number
}) {
  const id = useId()
  const [yearText, setYearText] = useState(String(value.year))
  const [error, setError] = useState<string | null>(null)
  const [synced, setSynced] = useState(value.year)
  if (value.year !== synced) {
    setSynced(value.year)
    setYearText(String(value.year))
    setError(null)
  }

  return (
    <FieldRow id={id} label={label} touched={touched} error={error ?? issue ?? null}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className="field__input field__input--year"
        value={yearText}
        aria-invalid={error !== null || Boolean(issue)}
        onChange={(event) => {
          const next = event.target.value
          setYearText(next)
          const parsed = parseNumber(next)
          if (parsed === null || !Number.isInteger(parsed)) {
            setError('年を整数で入れてください')
            return
          }
          if (parsed < minYear || parsed > maxYear) {
            setError(`${minYear}〜${maxYear}年にしてください`)
            return
          }
          setError(null)
          setSynced(parsed)
          onChange({ year: parsed, month: value.month })
        }}
      />
      <span className="field__unit">年</span>
      <select
        className="field__input field__input--month"
        aria-label={`${label}の月`}
        value={value.month}
        onChange={(event) => {
          const month = MONTHS.find((m) => m === Number(event.target.value))
          if (month === undefined) {
            throw new RangeError(`月の選択肢にない値です: ${event.target.value}`)
          }
          onChange({ year: value.year, month })
        }}
      >
        {MONTHS.map((month) => (
          <option key={month} value={month}>
            {month}
          </option>
        ))}
      </select>
      <span className="field__unit">月</span>
    </FieldRow>
  )
}

/** 文字列（カードの名前） */
export function TextField({
  label,
  touched,
  issue,
  value,
  onChange,
}: BaseProps & { value: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <FieldRow id={id} label={label} touched={touched} error={issue ?? null}>
      <input
        id={id}
        type="text"
        className="field__input field__input--text"
        value={value}
        aria-invalid={Boolean(issue)}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldRow>
  )
}

/**
 * 選択肢を横に並べたボタン（ラジオ）。働き方・カードの型など、2〜3 個から 1 つ選ぶ物に使う。
 * 押す回数を減らすため、`<select>` を開かずに 1 回で選べる形にする。
 *
 * - `value` が null なら、どれも選んでいない（大学資金の進路を持たない前の保存。D37）
 * - `stacked` は選択肢を縦に並べる（選択肢に額を添えて、額の桁を揃えたいとき。大学資金の進路）
 */
export function ChoiceField<T extends string>({
  label,
  touched,
  value,
  options,
  onChange,
  stacked = false,
}: Omit<BaseProps, 'issue'> & {
  value: T | null
  options: readonly { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  stacked?: boolean
}) {
  const name = useId()
  const labelId = `${name}-label`
  const className = [
    'choice',
    stacked ? 'choice--stacked' : null,
    touched ? 'is-touched' : 'is-default',
  ]
    .filter((part) => part !== null)
    .join(' ')
  // fieldset と legend は grid に並ばない（legend が枠の上に出る）ので、radiogroup の div で同じ意味を持たせる
  return (
    <div role="radiogroup" aria-labelledby={labelId} className={className} data-touched={touched}>
      <span id={labelId} className="field__label">
        {label}
        {value === null ? (
          <span className="visually-hidden">（選んでいない）</span>
        ) : touched ? null : (
          <span className="visually-hidden">（既定値のまま）</span>
        )}
      </span>
      <span className="choice__options">
        {options.map((option) => (
          <label key={option.value} className="choice__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span className="choice__text">{option.label}</span>
          </label>
        ))}
      </span>
    </div>
  )
}

/**
 * 住んでいる市区町村（全国地方公共団体コード）。名前かコードで打てるよう候補を出し、下に名前を出す。
 * 一覧に無いコード（見本の架空のコードなど）は、そう出すだけでエラーにはしない（計算は概算で続く。SPEC §2）。
 * 名前を打って候補を選ばなかったときは、名前が一覧の 1 件にだけ合えばそのコードにし、合わなければ保存せずに候補から選ぶよう出す
 */
export function MunicipalityField({
  label,
  touched,
  issue,
  value,
  onChange,
}: BaseProps & { value: string; onChange: (code: string) => void }) {
  const id = useId()
  const listId = `${id}-list`
  // 候補（約 1,900 件）は、欄に触れてから作る（開いた直後の描画を軽くする）
  const [listed, setListed] = useState(false)
  // 打っている途中の文字は部品が持ち、コードに直せたときだけ外へ渡す（「横浜市」をそのまま保存しない）
  const [text, setText] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    setText(value)
    setError(null)
  }
  const described = value.trim() === '' ? null : describeMunicipality(value)
  const note = described ?? (value.trim() === '' ? null : '一覧に無いコード')
  return (
    <FieldRow id={id} label={label} touched={touched} error={error ?? issue ?? null} note={note}>
      <input
        id={id}
        type="text"
        className="field__input field__input--code"
        list={listId}
        placeholder="市区町村名かコード"
        value={text}
        aria-invalid={error !== null || Boolean(issue)}
        onFocus={() => setListed(true)}
        onBlur={() => {
          // 打ち終えたら、保存したコードの形に揃える（直せない文字は、直してもらうため残す）
          if (error === null) setText(value)
        }}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const code = resolveMunicipality(next)
          if (code === null) {
            setError('候補から選んでください')
            return
          }
          setError(null)
          setSynced(code)
          onChange(code)
        }}
      />
      {listed ? <MunicipalityOptions id={listId} /> : null}
    </FieldRow>
  )
}

/** 市区町村の候補。中身は変わらないので、ほかの欄を直したときに作り直さない（memo） */
const MunicipalityOptions = memo(function MunicipalityOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {municipalityOptions().map((item) => (
        <option key={item.code} value={item.code}>
          {item.name === item.prefecture ? item.name : `${item.prefecture} ${item.name}`}
        </option>
      ))}
    </datalist>
  )
})

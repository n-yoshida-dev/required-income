/**
 * 階段の図（SPEC §4.1 の 2）。要る世帯年収の段と見込みの線を描き、見込みでも届かない所にだけ色を付ける。
 * 段を押すと `onSelect` でその段の位置を返す（内訳は呼び出し側が出す）。
 *
 * 面と線は SVG を枠いっぱいに伸ばして描き、金額・年・押す所は HTML で重ねる（幅 1280px でも字が大きくならない）。
 * 座標は `stairsGeometry.ts`、色・太さ・字の大きさ・枠の高さは CSS（`app/app.css` の `.stairs`）が持つ。
 * 段ごとの位置は CSS の変数（`--x`・`--w`・`--h`・`--e`。どれも 0〜1）で渡す。押す所（ボタン）は `--hx`・`--hw`（狭い段は広げてある）で、
 * 中の柱（`.stairs__column`）が年数に比例した段の位置に、白い柱と金額・年を置く。
 */

import type { CSSProperties } from 'react'
import type { Step } from '../../domain/plan/types'
import { formatMan, formatYearRange } from './format'
import { FRAME_SIZE, stairsGeometry } from './stairsGeometry'

type Props = {
  steps: readonly Step[]
  /** 選んでいる段の位置。無ければ null */
  selectedIndex: number | null
  onSelect: (index: number) => void
  /**
   * 比べる相手の段（「見直す」の今の計画。SPEC §4.3）。渡すと、その要る世帯年収を薄い線で重ねる（同じ目盛り）。
   * 「ながめる」は渡さない
   */
  compare?: readonly Step[]
}

/** CSS の変数を style に渡すための型 */
type Vars = CSSProperties & Record<`--${string}`, string | number>

/** 階段の図 */
export function StairsChart({ steps, selectedIndex, onSelect, compare = [] }: Props) {
  const {
    bars,
    profilePath,
    massPath,
    gapRects,
    expectedPath,
    endYearLabel,
    expectedLabel,
    comparePath,
  } = stairsGeometry(steps, undefined, compare)
  const labelBar = expectedLabel === null ? undefined : bars[expectedLabel.index]

  return (
    <div className="stairs" role="group" aria-label="階段">
      <svg
        className="stairs__plot"
        viewBox={`0 0 ${FRAME_SIZE} ${FRAME_SIZE}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="stairs__mass" d={massPath} />
        {gapRects.map((rect) => (
          <rect
            key={rect.x}
            className="stairs__gap"
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
          />
        ))}
        {/* 比べる相手（今の計画）の線は、面の上・見込みの線と案の線の下（同じなら案の線に隠れる） */}
        {comparePath === '' ? null : <path className="stairs__compare" d={comparePath} />}
        {expectedPath === '' ? null : <path className="stairs__expected-line" d={expectedPath} />}
        <path className="stairs__profile" d={profilePath} />
      </svg>

      {bars.map((bar) => {
        const step = steps[bar.index]
        if (step === undefined) return null
        const label =
          step.requiredGross === null
            ? `${formatYearRange(step.fromYear, step.toYear)} 届かない`
            : `${formatYearRange(step.fromYear, step.toYear)} ${formatMan(step.requiredGross)}`
        const vars: Vars = {
          '--x': bar.x,
          '--w': bar.width,
          '--hx': bar.hitX,
          '--hw': bar.hitWidth,
          '--h': bar.top,
          '--e': bar.expected,
        }
        return (
          <button
            key={step.fromYear}
            type="button"
            className={[
              'stairs__step',
              bar.short ? 'is-short' : '',
              bar.unsolved ? 'is-unsolved' : '',
              bar.index === selectedIndex ? 'is-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={vars}
            aria-label={label}
            aria-pressed={bar.index === selectedIndex}
            onClick={() => onSelect(bar.index)}
          >
            {/* 押す所は狭い段で広がるので、選んだ段の白い柱と字は、年数に比例した段の位置（柱）に置く */}
            <span className="stairs__column" aria-hidden="true">
              {bar.valueLabel === null ? null : (
                <span className={bar.smallLabel ? 'stairs__value is-small' : 'stairs__value'}>
                  <span className="num">{bar.valueLabel}</span>
                  {bar.caret ? <span className="stairs__caret" /> : null}
                </span>
              )}
              {bar.yearLabel === null ? null : (
                <span className="stairs__year num">{bar.yearLabel}</span>
              )}
            </span>
          </button>
        )
      })}

      {endYearLabel === null ? null : (
        <span className="stairs__end num" aria-hidden="true">
          {endYearLabel}
        </span>
      )}
      {expectedLabel === null || labelBar === undefined ? null : (
        <span
          className={`stairs__expected is-${expectedLabel.placement}`}
          style={{ '--r': 1 - (labelBar.x + labelBar.width), '--e': labelBar.expected } as Vars}
          aria-hidden="true"
        >
          見込み<span className="num">{expectedLabel.value}</span>万円
        </span>
      )}
    </div>
  )
}

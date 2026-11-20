/**
 * 文の中の数字（「900」「2,640」「4.3」）だけを数字の字（`.num`）にして出す。
 * 言葉は文として別のファイル（`features/home/nextStepText.ts` など）で組み、ここは字の種類を分けるだけ
 */

/** 数字のかたまり（カンマ・小数点を含む） */
const NUMBER_RUN = /([0-9][0-9,.]*[0-9]|[0-9])/

/** 文を描く。数字のかたまりは `<span class="num">` で包む */
export function NumText({ text }: { text: string }) {
  return (
    <>
      {text.split(NUMBER_RUN).map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

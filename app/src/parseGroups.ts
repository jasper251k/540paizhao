// 把「前三张是武康大楼，接下来两张外滩，剩下的安福路」这类说法拆成「地名 → 第几张」
// 也兼容旧格式：「1-3 武康大楼」一行一个

export type ParsedGroup = { name: string; nums: number[] }

const CN = '零〇一二两三四五六七八九十'
const CN_NUM = `[${CN}]+`

function cnToInt(s: string): number {
  const d: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (!s.includes('十')) return Number([...s].map((c) => d[c]).join(''))
  const [a, b] = s.split('十')
  return (a ? d[a] : 1) * 10 + (b ? d[b] : 0)
}

// 只在「第三」「三张」「三到五」这类位置把中文数字换成阿拉伯数字，地名里的「五角场」「七宝」不动
function normalize(text: string) {
  const conv = (m: string) => String(cnToInt(m))
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/开头|头/g, '前')
    .replace(/中间/g, '接下来')
    .replace(new RegExp(`(第|前|后|最后|倒数)\\s*(${CN_NUM})`, 'g'), (_, p, n) => p + conv(n))
    // 「一二三是…」「四五是…」：连写的单个中文数字当作编号列表
    .replace(new RegExp(`(^|[\\s，。,；;])([一二三四五六七八九]{2,})(?=\\s*(?:是|为|都是|在|：|:))`, 'g'), (_, p, n) => p + [...n].map(conv).join('、'))
    .replace(new RegExp(`(${CN_NUM})(?=\\s*张)`, 'g'), conv)
    .replace(new RegExp(`(${CN_NUM})(?=\\s*(?:到|至|-|~|、|和|跟|与)\\s*第?\\s*[\\d${CN}]+\\s*张)`, 'g'), conv)
    .replace(new RegExp(`(第\\s*\\d+\\s*张?\\s*(?:到|至|-|~|、|和|跟|与)\\s*第?\\s*)(${CN_NUM})`, 'g'), (_, p, n) => p + conv(n))
}

// 按句切开：换行、句号、分号、逗号（数字中间的逗号除外，「4,5」是列表），以及「然后」「接下来」这类连接词
function clauses(text: string) {
  return text
    .replace(/(然后|接着|接下来|之后|随后|再来|后面|剩下|剩余|其余|最后)/g, '\n$1')
    .replace(/(^|[\s，。,；;])后(?=\s*\d+\s*张)/g, '$1\n接下来')
    // 语音输入常没有标点：在「第 N 张」前断开，但「第1张到第3张」「第7张和第8张」中间不断
    .replace(/(?<!(?:到|至|-|~|—|–|、|和|跟|与)\s*)第\s*\d+\s*张/g, '\n$&')
    // 旧格式「4-6 外滩」前面只有空格时也断开
    .replace(/\s+(?=\d+(?:\s*[-~、,，]\s*\d+)*\s+[^\d\s])/g, '\n')
    // 「武康大楼3张外滩」：数量后面紧跟着地名，说明数量属于前一个地名
    .replace(/(\d+\s*张)(?=[^\s，。,；;、和跟与到至\-~\d是为都的])/g, '$1\n')
    .replace(/(\d)\s*[,，]\s*(?=\d)/g, '$1、')
    .split(/[\n。；;！!,，]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const D = '(\\d+)'
const SEP_RANGE = '\\s*(?:到|至|-|~|—|–)\\s*'
const SEP_LIST = '\\s*(?:、|和|跟|与|\\s)\\s*'

type Spec =
  | { kind: 'nums'; nums: number[] }
  | { kind: 'next'; n: number }
  | { kind: 'last'; n: number }
  | { kind: 'rest' }
  | { kind: 'all' }

const RULES: [RegExp, (m: RegExpMatchArray) => Spec][] = [
  [/(剩下|剩余|其余|其他|其它)(的)?(几张|那几张|这几张|都|全)?/, () => ({ kind: 'rest' })],
  [/(全部|所有|全都)(的)?(照片|图片|图)?(都)?/, () => ({ kind: 'all' })],
  [new RegExp(`(最后|末尾|倒数)\\s*(的)?\\s*${D}\\s*张`), (m) => ({ kind: 'last', n: +m[3] })],
  [/(最后|末尾)\s*(的)?\s*那?张/, () => ({ kind: 'last', n: 1 })],
  [new RegExp(`(最?前面?)\\s*(的)?\\s*${D}\\s*张?`), (m) => ({ kind: 'nums', nums: range(1, +m[3]) })],
  [
    new RegExp(`第?\\s*${D}\\s*张?${SEP_RANGE}第?\\s*${D}\\s*张?`),
    (m) => ({ kind: 'nums', nums: range(+m[1], +m[2]) }),
  ],
  [
    new RegExp(`第?\\s*\\d+\\s*张?(?:${SEP_LIST}第?\\s*\\d+\\s*张?)+`),
    (m) => ({ kind: 'nums', nums: (m[0].match(/\d+/g) ?? []).map(Number) }),
  ],
  [
    new RegExp(`(接下来|然后|接着|之后|随后|后面|再来|再|下面|下)\\s*(的)?\\s*${D}\\s*张`),
    (m) => ({ kind: 'next', n: +m[3] }),
  ],
  [/(接下来|然后|接着|之后|随后|后面|再来|再|下面|下)\s*(的)?\s*那?张/, () => ({ kind: 'next', n: 1 })],
  [new RegExp(`第\\s*${D}\\s*张?`), (m) => ({ kind: 'nums', nums: [+m[1]] })],
  [new RegExp(`${D}\\s*张`), (m) => ({ kind: 'next', n: +m[1] })],
  // 旧格式：行首单个数字「6 安福路」
  [new RegExp(`^${D}(?=\\s|[:：]|[^\\d])`), (m) => ({ kind: 'nums', nums: [+m[1]] })],
]

function range(a: number, b: number) {
  const out: number[] = []
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
  return out
}

const LEAD = /^(?:接下来|然后|接着|之后|随后|再来|再|后面|下面|都是|全是|就是|对应|分别是|拍的是|拍|是|为|都|在|去|到|的|这几张|那几张|这张|那张|照片|图片|[:：、\s])+/
const TRAIL = /(?:的照片|的图片|的图|照片|图片|那里|那边|这里|这边|附近|拍的|拍|的|[:：、\s])+$/

function cleanName(s: string) {
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(LEAD, '').replace(TRAIL, '').trim()
  }
  return s
}

export function parseGroups(text: string, count: number) {
  const max = count || Infinity
  const items: { name: string; spec: Spec | null; raw: string }[] = []
  for (const c of clauses(normalize(text))) {
    let spec: Spec | null = null
    let rest = c
    for (const [re, mk] of RULES) {
      const m = c.match(re)
      if (!m) continue
      spec = mk(m)
      rest = c.slice(0, m.index) + ' ' + c.slice(m.index! + m[0].length)
      break
    }
    const name = cleanName(rest)
    // 只有数字没有地名：多半是句子被切开了，接到下一句的地名上
    if (!name && spec) {
      items.push({ name: '', spec, raw: c })
      continue
    }
    if (name) {
      const pending = items.length && !items[items.length - 1].name ? items.pop()! : null
      items.push({ name, spec: spec ?? pending?.spec ?? null, raw: c })
    }
  }

  const used = new Set<number>()
  const groups: ParsedGroup[] = []
  const bad: string[] = []
  let cursor = 1
  const take = (nums: number[]) => nums.filter((n) => n >= 1 && n <= max && !used.has(n))
  const restLater: string[] = []

  items.forEach((it, i) => {
    if (!it.name) return bad.push(it.raw)
    let spec = it.spec
    // 没说第几张：最后一句当作「剩下的」，其他句当作「接下来一张」
    if (!spec) spec = i === items.length - 1 && items.length > 1 ? { kind: 'rest' } : items.length === 1 ? { kind: 'all' } : { kind: 'next', n: 1 }
    let nums: number[] = []
    if (spec.kind === 'rest') return restLater.push(it.name)
    if (spec.kind === 'all') nums = take(range(1, count))
    if (spec.kind === 'nums') nums = take(spec.nums)
    if (spec.kind === 'last' && count) nums = take(range(count - spec.n + 1, count))
    if (spec.kind === 'next') {
      while (used.has(cursor)) cursor++
      nums = take(range(cursor, cursor + spec.n - 1))
    }
    if (!nums.length) return bad.push(it.raw)
    nums.forEach((n) => used.add(n))
    if (spec.kind !== 'last') cursor = Math.max(cursor, Math.max(...nums) + 1)
    addTo(groups, it.name, nums)
  })

  for (const name of restLater) {
    const nums = take(range(1, count))
    if (!nums.length) {
      bad.push(name)
      continue
    }
    nums.forEach((n) => used.add(n))
    addTo(groups, name, nums)
  }
  groups.forEach((g) => g.nums.sort((a, b) => a - b))
  return { groups, bad }
}

// 同一个地名说了两次就合并
function addTo(groups: ParsedGroup[], name: string, nums: number[]) {
  const g = groups.find((x) => x.name === name)
  if (g) g.nums.push(...nums)
  else groups.push({ name, nums })
}

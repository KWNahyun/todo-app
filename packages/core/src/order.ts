/**
 * 순서(드래그 정렬)용 분수 인덱스 문자열. 예) "a0" < "a0V" < "a1".
 * 두 항목 사이에 끼우면 그 둘 사이 문자열을 새로 만들 뿐 → 다른 항목은 안 바뀜 → 기기 간 충돌 없음.
 * 두 기기가 같은 자리에 끼워 같은 값이 나오면 ID 로 순서를 정함 (sortByOrder).
 *
 * 알고리즘: David Greenspan, "Implementing Fractional Indexing" (rocicorp/fractional-indexing 과 같은 형식).
 * 비교는 반드시 문자 코드 순서 (localeCompare 금지).
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0]!;
const SMALLEST_INT = "A" + ZERO.repeat(26);

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b && b.slice(-1) === ZERO)) throw new Error("끝자리 0");
  if (b) {
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]!) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))]!;
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[da]! + midpoint(a.slice(1), null);
}

function intLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2;
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2;
  throw new Error(`순서 값 머리 글자가 잘못됨: ${head}`);
}

function intPart(key: string): string {
  const n = intLength(key[0]!);
  if (n > key.length) throw new Error(`순서 값이 잘못됨: ${key}`);
  return key.slice(0, n);
}

function validate(key: string): void {
  if (key === SMALLEST_INT) throw new Error(`순서 값이 잘못됨: ${key}`);
  const i = intPart(key);
  if (key.slice(i.length).slice(-1) === ZERO) throw new Error(`순서 값이 잘못됨: ${key}`);
}

function increment(x: string): string | null {
  const [head, ...digs] = x.split("") as [string, ...string[]];
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) + 1;
    if (d === DIGITS.length) digs[i] = ZERO;
    else {
      digs[i] = DIGITS[d]!;
      carry = false;
    }
  }
  if (!carry) return head + digs.join("");
  if (head === "Z") return "a" + ZERO;
  if (head === "z") return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > "a") digs.push(ZERO);
  else digs.pop();
  return h + digs.join("");
}

function decrement(x: string): string | null {
  const [head, ...digs] = x.split("") as [string, ...string[]];
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]!) - 1;
    if (d === -1) digs[i] = DIGITS.slice(-1);
    else {
      digs[i] = DIGITS[d]!;
      borrow = false;
    }
  }
  if (!borrow) return head + digs.join("");
  if (head === "a") return "Z" + DIGITS.slice(-1);
  if (head === "A") return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < "Z") digs.push(DIGITS.slice(-1));
  else digs.pop();
  return h + digs.join("");
}

/** a 와 b 사이 순서 값. a=null 이면 맨 앞, b=null 이면 맨 뒤. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validate(a);
  if (b !== null) validate(b);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a === null) {
    if (b === null) return "a" + ZERO;
    const ib = intPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INT) return ib + midpoint("", fb);
    if (ib < b) return ib;
    const r = decrement(ib);
    if (r === null) throw new Error("더 앞에 둘 수 없음");
    return r;
  }
  const ia = intPart(a);
  const fa = a.slice(ia.length);
  if (b === null) {
    const i = increment(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ib = intPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = increment(ia);
  if (i === null) throw new Error("더 뒤에 둘 수 없음");
  return i < b ? i : ia + midpoint(fa, null);
}

/** a 와 b 사이에 고르게 n 개. (v1 가져오기처럼 한꺼번에 순서를 매길 때) */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n === 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  if (b === null) {
    const out = [keyBetween(a, null)];
    while (out.length < n) out.push(keyBetween(out[out.length - 1]!, null));
    return out;
  }
  if (a === null) {
    const out = [keyBetween(null, b)];
    while (out.length < n) out.unshift(keyBetween(null, out[0]!));
    return out;
  }
  const mid = Math.floor(n / 2);
  const c = keyBetween(a, b);
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)];
}

export function compareOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** order 순, 같으면 id 순 (두 기기가 같은 값을 만들어도 모두에게 같은 순서). */
export function sortByOrder<T extends { id: string; order?: unknown }>(items: T[]): T[] {
  const key = (x: T) => (typeof x.order === "string" ? x.order : "");
  return [...items].sort((x, y) => compareOrder(key(x), key(y)) || compareOrder(x.id, y.id));
}

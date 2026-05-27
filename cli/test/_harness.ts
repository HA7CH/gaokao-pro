// Minimal zero-dependency unit-test harness, matching the hand-rolled style of
// smoke.ts. Unit test files register cases via `test(...)`; `run.ts` discovers
// every *.test.ts file, imports it (which registers its cases), then runs all.
type Case = { name: string; fn: () => void | Promise<void> };

const cases: Case[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  cases.push({ name, fn });
}

export function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(`${msg ?? "assertEqual"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertThrows(fn: () => unknown, msg: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${msg}: expected function to throw, but it did not`);
}

export async function runAll(): Promise<number> {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.fn();
      console.log(`  ok  ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${c.name}: ${(e as Error).message}`);
    }
  }
  return failed;
}

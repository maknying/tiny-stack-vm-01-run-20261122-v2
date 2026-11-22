// Tiny stack VM for make.fun's tiny stack ISA (v1). Node 22, stdlib only,
// no clock, no network, no randomness: two runs on the same input write
// identical bytes. Traps are thrown as plain numbers (their exit code).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dec = (v: number): number[] => [...String(v)].map((c) => c.charCodeAt(0));

function execute(p: Uint8Array, feed: Uint8Array) {
  const d = new Int32Array(256);
  let sp = 0;
  const ret = new Int32Array(64);
  let rp = 0;
  const mem = new Int32Array(256);
  const out: number[] = [];
  let fp = 0, pc = 0, steps = 0;
  const need = (n: number) => { if (sp < n) throw 2; };
  const room = (n: number) => { if (sp + n > 256) throw 3; };
  const done = (c: number) => ({ bytes: Uint8Array.from(out), exit: c });
  try {
    for (;;) {
      if (steps === 1000000) throw 10;
      if (pc < 0 || pc >= p.length) throw 9;
      const op = p[pc];
      const known = op <= 0x07 || (op >= 0x10 && op <= 0x1e) || (op >= 0x20 && op <= 0x22)
        || (op >= 0x30 && op <= 0x34) || (op >= 0x40 && op <= 0x41) || (op >= 0x50 && op <= 0x53);
      if (!known) throw 5;
      const imm = op === 0x01 ? 1 : op === 0x02 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
      if (pc + imm >= p.length) throw 9;
      steps++;
      const nx = pc + 1 + imm; // address of the next instruction
      pc = nx;
      switch (op) {
        case 0x00: return done(0);
        case 0x01:
          room(1);
          { const b = p[nx - 1]; d[sp++] = b >= 128 ? b - 256 : b; }
          break;
        case 0x02:
          room(1);
          d[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
          break;
        case 0x03: need(1); sp--; break;
        case 0x04:
          need(1); room(1);
          d[sp] = d[sp - 1]; sp++;
          break;
        case 0x05: {
          need(2);
          const t = d[sp - 1]; d[sp - 1] = d[sp - 2]; d[sp - 2] = t;
          break;
        }
        case 0x06:
          need(2); room(1);
          d[sp] = d[sp - 2]; sp++;
          break;
        case 0x07: {
          need(3);
          const t = d[sp - 3]; d[sp - 3] = d[sp - 2]; d[sp - 2] = d[sp - 1]; d[sp - 1] = t;
          break;
        }
        case 0x17: need(1); d[sp - 1] = -d[sp - 1]; break;
        case 0x1b: need(1); d[sp - 1] = ~d[sp - 1]; break;
        case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
        case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
        case 0x20: case 0x21: case 0x22: {
          need(2);
          const b = d[sp - 1], a = d[sp - 2];
          let r = 0;
          if (op === 0x10) r = (a + b) | 0;
          else if (op === 0x11) r = (a - b) | 0;
          else if (op === 0x12) r = Math.imul(a, b);
          else if (op === 0x13) { if (!b) throw 4; r = a === -2147483648 && b === -1 ? a : (a / b) | 0; }
          else if (op === 0x14) { if (!b) throw 4; r = b === -1 ? 0 : (a % b) | 0; }
          else if (op === 0x15) { if (!b) throw 4; r = Math.floor((a >>> 0) / (b >>> 0)) | 0; }
          else if (op === 0x16) { if (!b) throw 4; r = ((a >>> 0) % (b >>> 0)) | 0; }
          else if (op === 0x18) r = a & b;
          else if (op === 0x19) r = a | b;
          else if (op === 0x1a) r = a ^ b;
          else if (op === 0x1c) r = a << (b & 31);
          else if (op === 0x1d) r = a >> (b & 31);
          else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
          else if (op === 0x20) r = a === b ? 1 : 0;
          else if (op === 0x21) r = a < b ? 1 : 0;
          else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
          sp -= 2; d[sp++] = r;
          break;
        }
        case 0x30: case 0x31: case 0x32: {
          const raw = p[nx - 2] | (p[nx - 1] << 8);
          const off = raw >= 0x8000 ? raw - 0x10000 : raw;
          let take = true;
          if (op !== 0x30) {
            need(1);
            const v = d[--sp];
            take = op === 0x31 ? v === 0 : v !== 0;
          }
          if (take) pc = nx + off;
          break;
        }
        case 0x33: {
          if (rp === 64) throw 7;
          ret[rp++] = nx;
          pc = p[nx - 2] | (p[nx - 1] << 8);
          break;
        }
        case 0x34:
          if (!rp) throw 8;
          pc = ret[--rp];
          break;
        case 0x40: {
          need(1);
          const a = d[sp - 1];
          if (a < 0 || a > 255) throw 6;
          d[sp - 1] = mem[a];
          break;
        }
        case 0x41: {
          need(2);
          const a = d[sp - 1], v = d[sp - 2];
          if (a < 0 || a > 255) throw 6;
          sp -= 2; mem[a] = v;
          break;
        }
        case 0x50: {
          need(1);
          const t = dec(d[sp - 1]);
          if (out.length + t.length > 65536) throw 11;
          sp--;
          for (const b of t) out.push(b);
          break;
        }
        case 0x51:
          need(1);
          if (out.length + 1 > 65536) throw 11;
          out.push(d[--sp] & 255);
          break;
        case 0x52:
          room(1);
          d[sp++] = fp < feed.length ? feed[fp++] : -1;
          break;
        case 0x53:
          need(1);
          return done(d[--sp] & 255);
      }
    }
  } catch (e) {
    if (typeof e === 'number') return done(e);
    throw e;
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const prog = readFileSync(join(I, id, 'program.bin'));
  const feed = readFileSync(join(I, id, 'input.bin'));
  const r = execute(prog, feed);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.bytes);
  writeFileSync(join(O, id, 'exit.txt'), r.exit + '\n');
}

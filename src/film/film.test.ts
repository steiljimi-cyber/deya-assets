import { describe, expect, it } from "vitest";
import { compileStock, filmApply, intensityMix, negDensity } from "./model";
import { STOCKS, getStock } from "./stocks";
import { whiteBalanceMatrix, mul, luminance, toOklab, fromOklab, REC2020_TO_SRGB, SRGB_TO_REC2020, IDENTITY, Vec3 } from "./color";

describe("colour maths", () => {
  it("Rec.2020<->sRGB matrices invert and keep white", () => {
    const w = mul(REC2020_TO_SRGB, [1, 1, 1]);
    w.forEach((v) => expect(v).toBeCloseTo(1, 4));
    const c: Vec3 = [0.2, 0.5, 0.1];
    mul(SRGB_TO_REC2020, mul(REC2020_TO_SRGB, c)).forEach((v, i) => expect(v).toBeCloseTo(c[i], 6));
  });
  it("Rec.2020 luminance of white is 1", () => expect(luminance([1, 1, 1])).toBeCloseTo(1, 5));
  it("OKLab round-trips and white has L=1, a=b=0", () => {
    const lab = toOklab([1, 1, 1]);
    expect(lab[0]).toBeCloseTo(1, 3);
    expect(Math.abs(lab[1])).toBeLessThan(1e-3);
    expect(Math.abs(lab[2])).toBeLessThan(1e-3);
    const c: Vec3 = [0.3, 0.12, 0.6];
    fromOklab(toOklab(c)).forEach((v, i) => expect(v).toBeCloseTo(c[i], 5));
  });
  it("white balance is identity at 0/0 and warms/cools in the right direction", () => {
    expect(whiteBalanceMatrix(0, 0)).toEqual(IDENTITY);
    const g: Vec3 = [0.18, 0.18, 0.18];
    const warm = mul(whiteBalanceMatrix(50, 0), g);
    const cool = mul(whiteBalanceMatrix(-50, 0), g);
    expect(warm[0] / warm[2]).toBeGreaterThan(1.1);
    expect(cool[2] / cool[0]).toBeGreaterThan(1.1);
    expect(luminance(warm)).toBeCloseTo(0.18, 4); // exposure unchanged
    const mag = mul(whiteBalanceMatrix(0, 50), g);
    expect(mag[1]).toBeLessThan(mag[0]);
    expect(mag[1]).toBeLessThan(mag[2]);
  });
});

describe("film model", () => {
  it("characteristic curve is monotonic with toe and shoulder", () => {
    let prev = -1;
    for (let x = -4; x <= 4; x += 0.01) {
      const d = negDensity(x, 0.6, -1, 2.4, 0.2, 0.45);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    // slope ~gamma in the straight-line part, ~0 far outside
    const slope = (negDensity(0.6, 0.6, -1, 2.4, 0.2, 0.45) - negDensity(0.4, 0.6, -1, 2.4, 0.2, 0.45)) / 0.2;
    expect(Math.abs(slope - 0.6)).toBeLessThan(0.02);
    expect(negDensity(-3, 0.6, -1, 2.4, 0.2, 0.45)).toBeLessThan(0.01);
  });

  for (const def of STOCKS) {
    const c = compileStock(def);
    it(`${def.name}: mid grey -> calibrated neutral grey`, () => {
      const o = filmApply(c, [0.18, 0.18, 0.18]).out;
      const target = 0.18 * Math.pow(2, def.printExposure ?? 0);
      expect(o[1] / c.tint[1]).toBeCloseTo(target, 3);
      // neutral (up to the stock's deliberate tint)
      expect(Math.abs(o[0] / c.tint[0] - o[1] / c.tint[1])).toBeLessThan(0.01);
      expect(Math.abs(o[2] / c.tint[2] - o[1] / c.tint[1])).toBeLessThan(0.01);
    });
    it(`${def.name}: tone response is monotonic, bounded and rolls off highlights`, () => {
      let prev = -1;
      for (let ev = -10; ev <= 10; ev += 0.05) {
        const v = 0.18 * Math.pow(2, ev);
        const o = luminance(filmApply(c, [v, v, v]).out);
        expect(o).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(o).toBeLessThanOrEqual(1.05);
        prev = o;
      }
      // +6 EV over grey (digital would be 11.5) is held below paper white
      const hi = luminance(filmApply(c, [11.5, 11.5, 11.5]).out);
      expect(hi).toBeLessThanOrEqual(1.0);
      // local slope in highlights is lower than in mids (roll-off)
      const L = (ev: number) => Math.log2(luminance(filmApply(c, [0.18 * 2 ** ev, 0.18 * 2 ** ev, 0.18 * 2 ** ev]).out));
      expect(L(4.5) - L(4)).toBeLessThan(L(0.5) - L(0));
    });
    if (def.kind === "bw") {
      it(`${def.name}: B&W is neutral for coloured input`, () => {
        const o = filmApply(c, [0.5, 0.1, 0.05]).out;
        expect(Math.abs(o[0] / c.tint[0] - o[1] / c.tint[1])).toBeLessThan(1e-6);
      });
    }
  }

  it("colour negative shows crossover: shadows and highlights are not perfectly neutral", () => {
    const c = getStock("everyday-400");
    const hi = filmApply(c, [2, 2, 2]).out;
    expect(hi[0] - hi[2]).toBeGreaterThan(0.002); // warm highlights
  });

  it("intensity 0 is identity, 1 is full film", () => {
    const a: Vec3 = [0.3, 0.2, 0.1], b: Vec3 = [0.1, 0.5, 0.7];
    intensityMix(a, b, 0).forEach((v, i) => expect(v).toBeCloseTo(a[i], 9));
    intensityMix(a, b, 1).forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
  });
});

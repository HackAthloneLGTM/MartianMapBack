import { describe, expect, it } from 'vitest';
import { evaLimits, evaTiming } from '../src/analysis/eva.ts';

const base = {
  walkingSpeedKmh: 1,
  scienceStopMin: 30,
  returnTrip: true,
  doseRateMSvPerDay: 0.6,
  doseLimitMSv: 0.1,
  maxEvaMinutes: 480,
};

describe('evaLimits', () => {
  it('is dose-limited when the budget runs out before the time cap', () => {
    // 0.1 mSv at 0.025 mSv/h = 240 min; (240 - 30) / 2 = 105 min one way at 1 km/h = 1750 m
    const e = evaLimits(base);
    expect(e.limitedBy).toBe('dose');
    expect(e.doseLimitMinutes).toBeCloseTo(240);
    expect(e.maxOneWayDistanceM).toBeCloseTo(1750);
    expect(e.routeFraction).toBeNull();
  });

  it('is time-limited when the cap comes first, and with a zero dose rate', () => {
    expect(evaLimits({ ...base, doseLimitMSv: 10 }).limitedBy).toBe('time');
    const z = evaLimits({ ...base, doseRateMSvPerDay: 0 });
    expect(z.limitedBy).toBe('time');
    expect(z.doseLimitMinutes).toBeNull();
    expect(z.maxOneWayDistanceM).toBeCloseTo(((480 - 30) / 2 / 60) * 1000);
  });

  it('is the inverse of evaTiming: walking the max distance spends exactly the dose budget', () => {
    const e = evaLimits(base);
    expect(evaTiming(e.maxOneWayDistanceM, base).doseMSv).toBeCloseTo(base.doseLimitMSv);
    const oneWay = evaLimits({ ...base, returnTrip: false });
    expect(oneWay.maxOneWayDistanceM).toBeCloseTo(2 * e.maxOneWayDistanceM);
  });

  it('returns 0 m when the science stop uses the whole budget', () => {
    expect(evaLimits({ ...base, scienceStopMin: 600 }).maxOneWayDistanceM).toBe(0);
  });

  it('reports the route as a fraction of the limit', () => {
    expect(evaLimits(base, 875).routeFraction).toBeCloseTo(0.5);
  });
});

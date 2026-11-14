import type { EvaLimits, RouteMetrics, RouteOptions, RoutePoint } from '../../shared/types.ts';

export interface EvaTiming {
  oneWayMinutes: number;
  totalEvaMinutes: number;
  doseMSv: number;
}

/** Walking time at constant speed, optional return leg, science stop, and time-proportional dose. */
export function evaTiming(distanceM: number, o: Pick<RouteOptions, 'walkingSpeedKmh' | 'scienceStopMin' | 'returnTrip' | 'doseRateMSvPerDay'>): EvaTiming {
  const oneWayMinutes = (distanceM / 1000 / o.walkingSpeedKmh) * 60;
  const totalEvaMinutes = oneWayMinutes * (o.returnTrip ? 2 : 1) + o.scienceStopMin;
  const doseMSv = (totalEvaMinutes / 60) * (o.doseRateMSvPerDay / 24);
  return { oneWayMinutes, totalEvaMinutes, doseMSv };
}

/**
 * Inverse of evaTiming: the farthest one-way distance whose EVA stays under both the dose budget
 * (doseLimitMSv at doseRateMSvPerDay) and the time cap (maxEvaMinutes), science stop included.
 */
export function evaLimits(
  o: Pick<RouteOptions, 'walkingSpeedKmh' | 'scienceStopMin' | 'returnTrip' | 'doseRateMSvPerDay' | 'doseLimitMSv' | 'maxEvaMinutes'>,
  routeDistanceM?: number | null,
): EvaLimits {
  const doseLimitMinutes = o.doseRateMSvPerDay > 0 ? (o.doseLimitMSv / (o.doseRateMSvPerDay / 24)) * 60 : null;
  const limitedBy = doseLimitMinutes !== null && doseLimitMinutes < o.maxEvaMinutes ? 'dose' : 'time';
  const maxTotalMinutes = limitedBy === 'dose' ? doseLimitMinutes! : o.maxEvaMinutes;
  const walkMinutes = Math.max(0, maxTotalMinutes - o.scienceStopMin);
  const oneWayMinutes = walkMinutes / (o.returnTrip ? 2 : 1);
  const maxOneWayDistanceM = (oneWayMinutes / 60) * o.walkingSpeedKmh * 1000;
  let routeFraction: number | null = null;
  if (routeDistanceM != null) {
    routeFraction = maxOneWayDistanceM > 0 ? routeDistanceM / maxOneWayDistanceM : routeDistanceM > 0 ? Infinity : 0;
  }
  return { maxOneWayDistanceM, maxTotalMinutes, limitedBy, doseLimitMinutes, routeFraction };
}

/** Fills in `distance` on each point (mutates) and returns path metrics. */
export function pathMetrics(points: RoutePoint[], o: RouteOptions): RouteMetrics {
  let d2 = 0;
  let d3 = 0;
  let ascent = 0;
  let descent = 0;
  let maxSlope = 0;
  let slopeWeighted = 0;
  let slopeWeight = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.slope !== null && p.slope > maxSlope) maxSlope = p.slope;
    if (i === 0) {
      p.distance = 0;
      continue;
    }
    const q = points[i - 1];
    const seg = Math.hypot(p.x - q.x, p.y - q.y);
    d2 += seg;
    p.distance = d2;

    if (p.elevation !== null && q.elevation !== null) {
      const dz = p.elevation - q.elevation;
      d3 += Math.hypot(seg, dz);
      if (dz > 0) ascent += dz;
      else descent -= dz;
    } else {
      d3 += seg;
    }
    if (p.slope !== null && q.slope !== null) {
      slopeWeighted += seg * (p.slope + q.slope) * 0.5;
      slopeWeight += seg;
    }
  }

  return {
    distance2d: d2,
    distance3d: d3,
    ascent,
    descent,
    maxSlope,
    meanSlope: slopeWeight > 0 ? slopeWeighted / slopeWeight : (points[0]?.slope ?? 0),
    ...evaTiming(d2, o),
  };
}

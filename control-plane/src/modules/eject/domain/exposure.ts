export interface ExposureCeilings {
  readonly recipientSelected: number;
  readonly planEntitlement: number;
  readonly physicalSafety: number;
}

export function effectiveExposureLimit(ceilings: ExposureCeilings): number {
  const values = [
    ceilings.recipientSelected,
    ceilings.planEntitlement,
    ceilings.physicalSafety,
  ];

  if (
    !values.every(Number.isSafeInteger) ||
    values.some((value) => value < 0)
  ) {
    throw new RangeError(
      "Exposure ceilings must be non-negative safe integers",
    );
  }

  return Math.min(...values);
}

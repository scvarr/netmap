import type { SVGProps } from 'react';
import type { BlueprintSlot } from '../topology/baseTemplateTypes';

interface Props extends Omit<SVGProps<SVGElement>, 'ref'> {
  kind: BlueprintSlot['kind'];
  cx: number;
  cy: number;
  r: number;
  label: string;
}

export function EndpointMarker({ kind, cx, cy, r, label, fill, ...props }: Props) {
  if (kind === 'NETWORK_PORT') {
    // Keep the square's corners within the original circular footprint.
    const halfSide = r / Math.SQRT2;
    return <rect {...props} data-endpoint-marker x={cx - halfSide} y={cy - halfSide}
      width={2 * halfSide} height={2 * halfSide} fill={fill ?? "#60d4c9"} strokeLinejoin="round">
      <title>{label}</title>
    </rect>;
  }
  return <circle {...props} data-endpoint-marker cx={cx} cy={cy} r={r} fill={fill ?? "#f2d081"}>
    <title>{label}</title>
  </circle>;
}

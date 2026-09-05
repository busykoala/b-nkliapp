/** Calibrated to the painted sprites (300 × 200), not geographic compass angles.
 * A single illustration cannot reconstruct a bench's actual 3D viewpoint.
 * Ground alignment keeps uprights vertical and moves feet/shadows together.
 */
type Point = readonly [number, number];
const feet: Record<string, readonly Point[]> = {
  "wood-back-arm": [[45, 159], [94, 133], [204, 196], [252, 165]],
  "wood-back": [[46, 155], [84, 132], [210, 194], [248, 170]],
  "wood-backless": [[37, 127], [81, 103], [216, 167], [261, 135]],
  "metal-back-arm": [[52, 150], [97, 127], [202, 184], [249, 153]],
  "metal-back": [[54, 160], [94, 140], [204, 195], [244, 171]],
  "metal-backless": [[40, 129], [80, 108], [215, 170], [262, 138]],
  "stone-back-arm": [[50, 134], [78, 122], [214, 184], [252, 159]],
  "stone-back": [[51, 153], [78, 140], [212, 197], [248, 177]],
  "stone-backless": [[50, 130], [86, 110], [222, 174], [264, 148]],
};

// Quiet, usable ground in each background. The modest vertical shear aligns
// the long bench axis to the scene without tilting its vertical supports.
const grounds: Record<string, { x: number; y: number; scale: number; slope: number }> = {
  harbour: { x: 320, y: 425, scale: .94, slope: -.10 },
  city: { x: 320, y: 421, scale: .92, slope: -.10 },
  village: { x: 320, y: 425, scale: .94, slope: -.08 },
  lake: { x: 314, y: 425, scale: .94, slope: -.04 },
  forest: { x: 320, y: 425, scale: .95, slope: -.04 },
  country: { x: 320, y: 425, scale: .95, slope: -.05 },
  alpine: { x: 314, y: 425, scale: .94, slope: -.04 },
};

export function benchPlacement(sceneKind: string, asset: string, seats: number) {
  const kind = asset.match(/bench-(wood|metal|stone)-(back-arm|backless|back)-v1\.webp$/);
  const key = kind ? `${kind[1]}-${kind[2]}` : "wood-back";
  const contacts = feet[key].map(([x, y]) => ({ x: x * .88 - 132, y: y * .88 - 85 }));
  const centre = {
    x: contacts.reduce((sum, p) => sum + p.x, 0) / contacts.length,
    y: contacts.reduce((sum, p) => sum + p.y, 0) / contacts.length,
  };
  const ground = grounds[sceneKind] ?? grounds.country;
  const size = Number.isFinite(seats) && seats > 0 ? seats <= 2 ? .9 : seats >= 6 ? 1.08 : 1 : 1;
  const scale = ground.scale * size;
  const translateX = ground.x - centre.x * scale;
  const translateY = ground.y - (centre.y + ground.slope * centre.x) * scale;
  return {
    // Apply this once to sprite AND shadows, so all variants and seat counts
    // remain grounded. No per-frame calculations or extra image downloads.
    transform: `translate(${translateX} ${translateY}) scale(${scale}) matrix(1 ${ground.slope} 0 1 0 0)`,
    contacts,
    centre,
    contactRadius: key.startsWith("stone") ? 11 : 5,
    scale,
    slope: ground.slope,
    ground,
    translateX,
    translateY,
  };
}

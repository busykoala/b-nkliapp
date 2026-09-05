/** Static pigment variation for small, composable SVG artwork. No animation or
 * JavaScript texture generation; each filter stays within the portrait bounds. */
export function WatercolorPigment({ id }: { id: string }) {
  return <filter id={id} x="-4%" y="-4%" width="108%" height="108%" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".065" numOctaves="3" seed="17" result="grain" />
    <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="edges" />
    <feColorMatrix in="grain" type="saturate" values="0" />
    <feComponentTransfer>
      <feFuncR type="linear" slope=".55" intercept="-.1" />
      <feFuncG type="linear" slope=".55" intercept="-.1" />
      <feFuncB type="linear" slope=".55" intercept="-.1" />
    </feComponentTransfer>
    <feComposite in2="edges" operator="in" result="pigment" />
    <feBlend in="edges" in2="pigment" mode="screen" />
  </filter>;
}

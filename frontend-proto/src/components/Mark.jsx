/* Знак Integra: дві половини «H» з трафаретним розривом і скошеними кутами. Колір — currentColor. */
const D = "M0,78 L80,0 L125,0 L125,128 L233,128 L233,433 L125,433 L125,566 L80,566 L0,486Z M563,78 L483,0 L438,0 L438,128 L330,128 L330,433 L438,433 L438,566 L483,566 L563,486Z";
export const Mark = ({ size = 22 }) => <svg viewBox="0 0 563 566" width={size} height={size} aria-hidden="true" focusable="false"><path fill="currentColor" d={D} /></svg>;

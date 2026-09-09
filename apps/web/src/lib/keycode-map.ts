/**
 * Browser KeyboardEvent.code (physical, layout-independent) → nut.js
 * `Key` enum member name (design doc §3.4 / packages/native-bridge's
 * nutjs-bridge.ts does `Key[keyName]` on the receiving end — this table
 * is the only place that translation happens, so it's the only place
 * that needs updating if nut.js's Key names ever change).
 *
 * Deliberately not exhaustive — covers what a teacher actually needs to
 * drive a student's desktop for classroom purposes. An unmapped key is
 * silently dropped (see RemoteControlView), not sent as a guess.
 */
export const CODE_TO_NUT_KEY: Record<string, string> = {
  Escape: 'Escape',
  Backspace: 'Backspace',
  Tab: 'Tab',
  CapsLock: 'CapsLock',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Space: 'Space',
  ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift',
  ControlLeft: 'LeftControl',
  ControlRight: 'RightControl',
  AltLeft: 'LeftAlt',
  AltRight: 'RightAlt',
  MetaLeft: 'LeftWin',
  MetaRight: 'RightWin',
  ContextMenu: 'Menu',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  PrintScreen: 'Print',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  NumLock: 'NumLock',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Backquote: 'Grave',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  NumpadAdd: 'Add',
  NumpadSubtract: 'Subtract',
  NumpadMultiply: 'Multiply',
  NumpadDivide: 'Divide',
  NumpadDecimal: 'Decimal',
  NumpadEqual: 'NumPadEqual',
};

for (let i = 0; i <= 9; i++) {
  CODE_TO_NUT_KEY[`Digit${i}`] = `Num${i}`;
  CODE_TO_NUT_KEY[`Numpad${i}`] = `NumPad${i}`;
}
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  CODE_TO_NUT_KEY[`Key${letter}`] = letter;
}
for (let i = 1; i <= 24; i++) {
  CODE_TO_NUT_KEY[`F${i}`] = `F${i}`;
}

export function codeToNutKeyName(code: string): string | undefined {
  return CODE_TO_NUT_KEY[code];
}

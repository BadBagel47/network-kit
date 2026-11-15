// Wire protocol shared by the room server and the browser client.
// Both sides of one game always use the same network-kit version (D-009),
// so the protocol number only guards against mixed copies.

export const PROTOCOL = 1;

// Room codes: no 0/O or 1/I so codes are easy to read out loud.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

// WebSocket close codes sent by the server. The client stops reconnecting
// on all of them (see FINAL_CLOSE_CODES).
export const CLOSE = Object.freeze({
  ROOM_CLOSED: 4000,
  KICKED: 4001,
  BANNED: 4002,
  REPLACED: 4003,
  NOT_FOUND: 4004,
  FULL: 4005,
  IN_PROGRESS: 4006,
  KEY: 4007,
  GAME_CLOSED: 4008,
  VERSION: 4009,
  BAD_REQUEST: 4010,
  LEFT: 4011,
});

export const FINAL_CLOSE_CODES = new Set(Object.values(CLOSE));

// Plain-language reasons for close codes, for games that show them as is.
export const CLOSE_TEXT = Object.freeze({
  [CLOSE.ROOM_CLOSED]: 'The room has closed.',
  [CLOSE.KICKED]: 'You were removed from the room.',
  [CLOSE.BANNED]: 'You cannot join this room.',
  [CLOSE.REPLACED]: 'The room was opened in another tab.',
  [CLOSE.NOT_FOUND]: 'Room not found.',
  [CLOSE.FULL]: 'The room is full.',
  [CLOSE.IN_PROGRESS]: 'The game has already started.',
  [CLOSE.KEY]: 'This room needs a valid invitation link.',
  [CLOSE.GAME_CLOSED]: 'The game is closed right now.',
  [CLOSE.VERSION]: 'Please reload the page to get the latest version.',
  [CLOSE.BAD_REQUEST]: 'Could not join the room.',
  [CLOSE.LEFT]: 'You left the room.',
});

/** Upper-case a typed room code and drop spaces and dashes. */
export function normalizeCode(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

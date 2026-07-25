export const ROOM_CODE_LENGTH = 6;

const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidRoomCode(value: string): boolean {
  return ROOM_CODE_PATTERN.test(normalizeRoomCode(value));
}

export function validateRoomCode(value: string): string | null {
  if (normalizeRoomCode(value).length !== ROOM_CODE_LENGTH) {
    return "친구에게 받은 방 코드 6자리를 입력해 주세요.";
  }
  if (!isValidRoomCode(value)) {
    return "방 코드를 다시 확인해 주세요.";
  }
  return null;
}

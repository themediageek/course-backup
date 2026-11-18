// An error the packing page can explain to a faculty member.
// code is one of: 'not-zip', 'not-canvas', 'empty', 'too-large'.
export class PackError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PackError';
    this.code = code;
  }
}

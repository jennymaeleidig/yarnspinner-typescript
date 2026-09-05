/**
 * CRC-32 (upstream `YarnSpinner/CRC32.cs`): the checksum behind the
 * compiler's implicit line IDs — upstream seeds CRC32 over the UTF-8 bytes
 * of `fileName + nodeName + tableCount` and formats the checksum as
 * little-endian lowercase hex (C# `BitConverter.GetBytes` +
 * `BitConverter.ToString`), so the formatting here mirrors that byte order
 * rather than the conventional big-endian rendering.
 *
 * The standard parameters (reflected polynomial 0xEDB88320, initial value
 * 0xFFFFFFFF, final complement — ISO 3309 / ITU-T V.42) match upstream's
 * implementation.
 *
 * Adapted from YarnSpinner's CRC32.cs — see CITATION.cff.
 * Citation: Yarn Spinner Pty. Ltd., Secret Lab Pty. Ltd., and contributors —
 * YarnSpinner (main @ ec1a680) [MIT]
 * Source: https://github.com/YarnSpinnerTool/YarnSpinner/blob/main/YarnSpinner/CRC32.cs
 * Accessed: 2026-09-02
 */

// SPDX-License-Identifier: CC0-1.0

const LOOKUP_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let temp = i;
  for (let j = 0; j < 8; j++) {
    temp = temp & 1 ? (temp >>> 1) ^ 0xedb88320 : temp >>> 1;
  }
  LOOKUP_TABLE[i] = temp >>> 0;
}

const encoder = new TextEncoder();

/** The CRC-32 checksum of a string (UTF-8 encoded), as an unsigned integer. */
export function crc32(s: string): number {
  const bytes = encoder.encode(s);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const index = (crc ^ bytes[i]) & 0xff;
    crc = (crc >>> 8) ^ LOOKUP_TABLE[index];
  }
  return ~crc >>> 0;
}

/**
 * The CRC-32 hash of `s` as 8 lowercase hex characters, little-endian byte
 * order (upstream `CRC32.GetChecksumString`).
 */
export function crc32Hex(s: string): string {
  const checksum = crc32(s);
  const bytes = [
    checksum & 0xff,
    (checksum >>> 8) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 24) & 0xff,
  ];
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

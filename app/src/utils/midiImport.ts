/* ============================================================
  MIDI IMPORT UTILITIES

  Converts a standard MIDI file (.mid) into HarmonySinging-compatible
  voice nodes and helpful review metadata for the Create modal.
  ============================================================ */

import type { Node } from '../types';

const MIDI_HEADER_CHUNK = 'MThd';
const MIDI_TRACK_CHUNK = 'MTrk';
const DRUM_CHANNEL = 9; // MIDI channel 10 is index 9.
const EPSILON = 0.0001;
const MAX_BARS = 32;
const SHARP_MAJOR_KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const FLAT_MAJOR_KEYS = ['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
const SHARP_MINOR_KEYS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
const FLAT_MINOR_KEYS = ['A', 'D', 'G', 'C', 'F', 'Bb', 'Eb', 'Ab'];
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface RawMidiNote {
  noteNumber: number;
  velocity: number;
  startTick: number;
  endTick: number;
}

interface RawTrackData {
  index: number;
  name: string;
  channel: number | null;
  notes: RawMidiNote[];
}

interface ParsedMidiFile {
  format: number;
  ticksPerQuarter: number;
  tempoBpm: number | null;
  timeSigNumerator: number | null;
  timeSigDenominator: number | null;
  keySignatureSharpsFlats: number | null;
  keySignatureIsMinor: boolean | null;
  tracks: RawTrackData[];
}

export interface MidiTrackReview {
  trackIndex: number;
  name: string;
  channel: number | null;
  importable: boolean;
  selectedByDefault: boolean;
  noteCount: number;
  startTick: number;
  endTick: number;
  issues: string[];
  nodes: Node[];
}

export interface MidiImportPreview {
  fileName: string;
  titleSuggestion: string;
  format: number;
  ticksPerQuarter: number;
  tempoBpm: number;
  timeSigNumerator: number;
  timeSigDenominator: number;
  totalBars: number;
  totalT16: number;
  tonic: string;
  scale: 'major' | 'minor' | 'chromatic';
  tracks: MidiTrackReview[];
  globalIssues: string[];
}

class MidiReader {
  private view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  get length(): number {
    return this.view.byteLength;
  }

  ensureAvailable(byteCount: number): void {
    if (this.offset + byteCount > this.view.byteLength) {
      throw new Error('Unexpected end of MIDI file.');
    }
  }

  readUint8(): number {
    this.ensureAvailable(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    this.ensureAvailable(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    this.ensureAvailable(4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  readAscii(length: number): string {
    this.ensureAvailable(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += String.fromCharCode(this.view.getUint8(this.offset + i));
    }
    this.offset += length;
    return result;
  }

  readBytes(length: number): Uint8Array {
    this.ensureAvailable(length);
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return bytes;
  }

  skip(length: number): void {
    this.ensureAvailable(length);
    this.offset += length;
  }

  readVariableLength(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.readUint8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        return value;
      }
    }

    throw new Error('Invalid MIDI variable-length integer.');
  }
}

function tickToT16(tick: number, ticksPerQuarter: number): number {
  const raw = (tick * 4) / ticksPerQuarter;
  return Number(raw.toFixed(4));
}

function sanitizeTitle(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^.]+$/, '');
  const cleaned = withoutExt.replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'Imported MIDI';
  return cleaned;
}

function parseTrackChunk(index: number, bytes: Uint8Array): {
  name: string;
  channel: number | null;
  notes: RawMidiNote[];
  tempoBpm: number | null;
  timeSigNumerator: number | null;
  timeSigDenominator: number | null;
  keySignatureSharpsFlats: number | null;
  keySignatureIsMinor: boolean | null;
} {
  const reader = new MidiReader(bytes);
  const activeNotes = new Map<number, Array<{ startTick: number; velocity: number }>>();
  const notes: RawMidiNote[] = [];

  let timeTick = 0;
  let runningStatus: number | null = null;
  let trackName = '';
  let channel: number | null = null;
  let tempoBpm: number | null = null;
  let timeSigNumerator: number | null = null;
  let timeSigDenominator: number | null = null;
  let keySignatureSharpsFlats: number | null = null;
  let keySignatureIsMinor: boolean | null = null;

  while (reader.position < reader.length) {
    const delta = reader.readVariableLength();
    timeTick += delta;

    let statusByte = reader.readUint8();
    let firstDataByte: number | null = null;

    if ((statusByte & 0x80) === 0) {
      if (runningStatus === null) {
        throw new Error(`Invalid MIDI running status in track ${index + 1}.`);
      }
      firstDataByte = statusByte;
      statusByte = runningStatus;
    } else {
      // Running status is valid only for channel voice messages (0x80..0xEF).
      runningStatus = statusByte < 0xf0 ? statusByte : null;
    }

    if (statusByte === 0xff) {
      // Meta event
      const metaType = reader.readUint8();
      const metaLength = reader.readVariableLength();

      if (metaType === 0x2f) {
        // End-of-track
        reader.skip(metaLength);
        break;
      }

      if (metaType === 0x03) {
        // Track name
        const rawName = reader.readBytes(metaLength);
        trackName = new TextDecoder().decode(rawName).trim();
        continue;
      }

      if (metaType === 0x59 && metaLength >= 2 && keySignatureSharpsFlats === null && keySignatureIsMinor === null) {
        // Key Signature:
        // - first byte: sharps(+) / flats(-) count as signed int8
        // - second byte: 0=major, 1=minor
        const sharpsFlatsRaw = reader.readUint8();
        const modeRaw = reader.readUint8();
        const sharpsFlats = sharpsFlatsRaw > 127 ? sharpsFlatsRaw - 256 : sharpsFlatsRaw;

        keySignatureSharpsFlats = sharpsFlats;
        keySignatureIsMinor = modeRaw === 1;

        if (metaLength > 2) {
          reader.skip(metaLength - 2);
        }
        continue;
      }

      if (metaType === 0x51 && metaLength === 3 && tempoBpm === null) {
        // Tempo: microseconds per quarter note
        const t1 = reader.readUint8();
        const t2 = reader.readUint8();
        const t3 = reader.readUint8();
        const usPerQuarter = (t1 << 16) | (t2 << 8) | t3;
        if (usPerQuarter > 0) {
          tempoBpm = 60000000 / usPerQuarter;
        }
        continue;
      }

      if (metaType === 0x58 && metaLength >= 2 && timeSigNumerator === null && timeSigDenominator === null) {
        const numerator = reader.readUint8();
        const denominatorPow = reader.readUint8();
        const denominator = 2 ** denominatorPow;
        timeSigNumerator = numerator;
        timeSigDenominator = denominator;

        if (metaLength > 2) {
          reader.skip(metaLength - 2);
        }
        continue;
      }

      reader.skip(metaLength);
      continue;
    }

    if (statusByte === 0xf0 || statusByte === 0xf7) {
      // SysEx event
      const sysExLength = reader.readVariableLength();
      reader.skip(sysExLength);
      continue;
    }

    const eventType = statusByte & 0xf0;
    const eventChannel = statusByte & 0x0f;
    if (channel === null) {
      channel = eventChannel;
    }

    const data1 = firstDataByte ?? reader.readUint8();

    if (eventType === 0x80 || eventType === 0x90) {
      const velocity = reader.readUint8();
      const isNoteOn = eventType === 0x90 && velocity > 0;
      const noteNumber = data1;

      if (isNoteOn) {
        const activeForNote = activeNotes.get(noteNumber) ?? [];
        activeForNote.push({ startTick: timeTick, velocity });
        activeNotes.set(noteNumber, activeForNote);
      } else {
        const activeForNote = activeNotes.get(noteNumber);
        if (activeForNote && activeForNote.length > 0) {
          const started = activeForNote.pop();
          if (started && timeTick > started.startTick) {
            notes.push({
              noteNumber,
              velocity: started.velocity,
              startTick: started.startTick,
              endTick: timeTick,
            });
          }
          if (activeForNote.length === 0) {
            activeNotes.delete(noteNumber);
          }
        }
      }
      continue;
    }

    // Remaining channel events: skip data bytes.
    const dataByteCount = (eventType === 0xc0 || eventType === 0xd0) ? 1 : 2;
    if (dataByteCount === 2) {
      reader.readUint8();
    }
  }

  notes.sort((a, b) => {
    if (a.startTick !== b.startTick) return a.startTick - b.startTick;
    if (a.endTick !== b.endTick) return a.endTick - b.endTick;
    return a.noteNumber - b.noteNumber;
  });

  return {
    name: trackName || `Track ${index + 1}`,
    channel,
    notes,
    tempoBpm,
    timeSigNumerator,
    timeSigDenominator,
    keySignatureSharpsFlats,
    keySignatureIsMinor,
  };
}

function keySignatureToTonicAndScale(
  sharpsFlats: number,
  isMinor: boolean
): { tonic: string; scale: 'major' | 'minor' } | null {
  if (sharpsFlats < -7 || sharpsFlats > 7) return null;

  const index = Math.abs(sharpsFlats);
  if (isMinor) {
    if (sharpsFlats >= 0) {
      return { tonic: SHARP_MINOR_KEYS[index], scale: 'minor' };
    }
    return { tonic: FLAT_MINOR_KEYS[index], scale: 'minor' };
  }

  if (sharpsFlats >= 0) {
    return { tonic: SHARP_MAJOR_KEYS[index], scale: 'major' };
  }
  return { tonic: FLAT_MAJOR_KEYS[index], scale: 'major' };
}

function scoreScaleFit(pitchClassDurations: number[], tonicPc: number, scalePattern: number[]): number {
  let inScale = 0;
  let total = 0;

  for (let pc = 0; pc < 12; pc++) {
    const duration = pitchClassDurations[pc] ?? 0;
    if (duration <= 0) continue;

    total += duration;
    const rel = ((pc - tonicPc) % 12 + 12) % 12;
    if (scalePattern.includes(rel)) {
      inScale += duration;
    }
  }

  return total > 0 ? inScale / total : 0;
}

function guessTonicAndScaleFromTracks(tracks: RawTrackData[]): { tonic: string; scale: 'major' | 'minor' } {
  const pitchClassDurations = new Array<number>(12).fill(0);

  for (const track of tracks) {
    for (const note of track.notes) {
      const pitchClass = ((note.noteNumber % 12) + 12) % 12;
      const duration = Math.max(1, note.endTick - note.startTick);
      pitchClassDurations[pitchClass] += duration;
    }
  }

  const majorPattern = [0, 2, 4, 5, 7, 9, 11];
  const minorPattern = [0, 2, 3, 5, 7, 8, 10];

  let bestTonicPc = 0;
  let bestScale: 'major' | 'minor' = 'major';
  let bestScore = -1;

  for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
    const majorScore = scoreScaleFit(pitchClassDurations, tonicPc, majorPattern);
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestTonicPc = tonicPc;
      bestScale = 'major';
    }

    const minorScore = scoreScaleFit(pitchClassDurations, tonicPc, minorPattern);
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestTonicPc = tonicPc;
      bestScale = 'minor';
    }
  }

  return {
    tonic: NOTE_NAMES_SHARP[bestTonicPc] || 'C',
    scale: bestScale,
  };
}

function parseMidi(bytes: Uint8Array): ParsedMidiFile {
  const reader = new MidiReader(bytes);

  const headerId = reader.readAscii(4);
  if (headerId !== MIDI_HEADER_CHUNK) {
    throw new Error('This file is not a valid MIDI file (missing MThd header).');
  }

  const headerLength = reader.readUint32();
  if (headerLength < 6) {
    throw new Error('MIDI header is invalid.');
  }

  const format = reader.readUint16();
  const trackCount = reader.readUint16();
  const division = reader.readUint16();

  if ((division & 0x8000) !== 0) {
    throw new Error('SMPTE-timed MIDI files are not supported yet. Please export with PPQ timing.');
  }

  const ticksPerQuarter = division;
  if (headerLength > 6) {
    reader.skip(headerLength - 6);
  }

  const tracks: RawTrackData[] = [];
  let tempoBpm: number | null = null;
  let timeSigNumerator: number | null = null;
  let timeSigDenominator: number | null = null;
  let keySignatureSharpsFlats: number | null = null;
  let keySignatureIsMinor: boolean | null = null;

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
    const trackId = reader.readAscii(4);
    if (trackId !== MIDI_TRACK_CHUNK) {
      throw new Error(`Track ${trackIndex + 1} is invalid (missing MTrk chunk).`);
    }

    const trackLength = reader.readUint32();
    const trackBytes = reader.readBytes(trackLength);
    const parsedTrack = parseTrackChunk(trackIndex, trackBytes);

    if (tempoBpm === null && parsedTrack.tempoBpm !== null) {
      tempoBpm = parsedTrack.tempoBpm;
    }

    if (timeSigNumerator === null && parsedTrack.timeSigNumerator !== null) {
      timeSigNumerator = parsedTrack.timeSigNumerator;
    }

    if (timeSigDenominator === null && parsedTrack.timeSigDenominator !== null) {
      timeSigDenominator = parsedTrack.timeSigDenominator;
    }

    if (keySignatureSharpsFlats === null && parsedTrack.keySignatureSharpsFlats !== null) {
      keySignatureSharpsFlats = parsedTrack.keySignatureSharpsFlats;
    }

    if (keySignatureIsMinor === null && parsedTrack.keySignatureIsMinor !== null) {
      keySignatureIsMinor = parsedTrack.keySignatureIsMinor;
    }

    tracks.push({
      index: trackIndex,
      name: parsedTrack.name,
      channel: parsedTrack.channel,
      notes: parsedTrack.notes,
    });
  }

  return {
    format,
    ticksPerQuarter,
    tempoBpm,
    timeSigNumerator,
    timeSigDenominator,
    keySignatureSharpsFlats,
    keySignatureIsMinor,
    tracks,
  };
}

function detectPolyphony(notes: RawMidiNote[]): boolean {
  if (notes.length <= 1) return false;

  let latestEndTick = notes[0].endTick;

  for (let i = 1; i < notes.length; i++) {
    const note = notes[i];
    if (note.startTick < latestEndTick) {
      return true;
    }

    latestEndTick = Math.max(latestEndTick, note.endTick);
  }

  return false;
}

function buildNodesFromNotes(notes: RawMidiNote[], ticksPerQuarter: number): Node[] {
  const nodes: Node[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const nextNote = notes[i + 1];

    const startT16 = tickToT16(note.startTick, ticksPerQuarter);
    const endT16 = tickToT16(note.endTick, ticksPerQuarter);
    const nextStartT16 = nextNote ? tickToT16(nextNote.startTick, ticksPerQuarter) : null;

    nodes.push({
      t16: startT16,
      semi: note.noteNumber - 60,
    });

    // Insert a phrase-end marker only when there is a real silent gap.
    if (endT16 > startT16 + EPSILON && (nextStartT16 === null || endT16 < nextStartT16 - EPSILON)) {
      nodes.push({ t16: endT16, term: true });
    }
  }

  nodes.sort((a, b) => a.t16 - b.t16);

  // Remove exact duplicate nodes that can appear after timing quantization.
  const deduped: Node[] = [];
  for (const node of nodes) {
    const prev = deduped[deduped.length - 1];
    if (!prev) {
      deduped.push(node);
      continue;
    }

    if (Math.abs(prev.t16 - node.t16) < EPSILON) {
      // Prefer a pitched node over a term marker at the same location.
      if (prev.term && !node.term) {
        deduped[deduped.length - 1] = node;
      }
      continue;
    }

    deduped.push(node);
  }

  return deduped;
}

export async function parseMidiFileToPreview(file: File): Promise<MidiImportPreview> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseMidi(bytes);

  const tempoBpm = Math.max(40, Math.min(240, Math.round(parsed.tempoBpm ?? 120)));
  const timeSigNumerator = Math.max(2, Math.min(12, parsed.timeSigNumerator ?? 4));
  const timeSigDenominator = [2, 4, 8].includes(parsed.timeSigDenominator ?? 4)
    ? (parsed.timeSigDenominator ?? 4)
    : 4;

  const globalIssues: string[] = [];
  if (parsed.tempoBpm === null) {
    globalIssues.push('No tempo event found. Using 120 BPM.');
  }
  if (parsed.timeSigNumerator === null || parsed.timeSigDenominator === null) {
    globalIssues.push('No time signature event found. Using 4/4.');
  }

  let keyFromMeta: { tonic: string; scale: 'major' | 'minor' } | null = null;
  if (parsed.keySignatureSharpsFlats !== null && parsed.keySignatureIsMinor !== null) {
    keyFromMeta = keySignatureToTonicAndScale(parsed.keySignatureSharpsFlats, parsed.keySignatureIsMinor);
  }

  const guessedKey = guessTonicAndScaleFromTracks(parsed.tracks);
  const resolvedKey = keyFromMeta ?? guessedKey;

  if (keyFromMeta) {
    globalIssues.push(`Imported key signature from MIDI: ${resolvedKey.tonic} ${resolvedKey.scale}.`);
  } else {
    globalIssues.push(`No MIDI key signature found. Best guess: ${resolvedKey.tonic} ${resolvedKey.scale}.`);
  }

  const tracks: MidiTrackReview[] = parsed.tracks.map((track) => {
    const issues: string[] = [];

    if (track.notes.length === 0) {
      issues.push('No note events found in this track.');
    }

    if (track.channel === DRUM_CHANNEL) {
      issues.push('This appears to be a percussion track (MIDI channel 10), so it will not be imported as melody.');
    }

    const polyphonic = detectPolyphony(track.notes);
    if (polyphonic) {
      issues.push('This track is polyphonic (overlapping notes). HarmonySinging voice lanes must be monophonic.');
    }

    const importable = issues.length === 0;
    const nodes = importable ? buildNodesFromNotes(track.notes, parsed.ticksPerQuarter) : [];

    return {
      trackIndex: track.index,
      name: track.name,
      channel: track.channel,
      importable,
      selectedByDefault: false,
      noteCount: track.notes.length,
      startTick: track.notes[0]?.startTick ?? 0,
      endTick: track.notes[track.notes.length - 1]?.endTick ?? 0,
      issues,
      nodes,
    };
  });

  let selectedCount = 0;
  const tracksWithSelection = tracks.map((track) => {
    const shouldSelect = track.importable && selectedCount < 6;
    if (shouldSelect) selectedCount += 1;
    return { ...track, selectedByDefault: shouldSelect };
  });

  const maxEndTick = tracksWithSelection.reduce((max, track) => Math.max(max, track.endTick), 0);
  const ticksPerBar = parsed.ticksPerQuarter * 4 * (timeSigNumerator / timeSigDenominator);
  const unclampedBars = Math.max(1, Math.ceil(maxEndTick / Math.max(1, ticksPerBar)));
  const totalBars = Math.max(1, Math.min(MAX_BARS, unclampedBars));

  if (unclampedBars > MAX_BARS) {
    globalIssues.push(`The MIDI is longer than ${MAX_BARS} bars. Import will be truncated to ${MAX_BARS} bars.`);
  }

  if (selectedCount === 0) {
    globalIssues.push('No importable melody tracks were found.');
  }

  if (tracksWithSelection.filter((t) => t.importable).length > 6) {
    globalIssues.push('More than 6 importable tracks were found. Only 6 can be selected at once.');
  }

  const totalT16 = totalBars * timeSigNumerator * 4;

  return {
    fileName: file.name,
    titleSuggestion: sanitizeTitle(file.name),
    format: parsed.format,
    ticksPerQuarter: parsed.ticksPerQuarter,
    tempoBpm,
    timeSigNumerator,
    timeSigDenominator,
    totalBars,
    totalT16,
    tonic: resolvedKey.tonic,
    scale: resolvedKey.scale,
    tracks: tracksWithSelection,
    globalIssues,
  };
}

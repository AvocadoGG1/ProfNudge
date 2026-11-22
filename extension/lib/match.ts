import type { RosterProf } from './types';

export type Confidence = 'confident' | 'possible' | 'ambiguous';

export interface ScheduleMatch {
  candidates: RosterProf[];
  confidence: Confidence;
  matchedText: string;
  course?: string;
}

export const fullName = (p: RosterProf) => `${p.firstName} ${p.lastName}`;

interface Token {
  value: string;
  start: number;
  end: number;
}

interface RosterName {
  prof: RosterProf;
  first: string[];
  initial: string;
}

interface LineMatch {
  candidates: RosterProf[];
  confidence: Confidence;
  start: number;
  end: number;
  surnameStart: number;
  surnameEnd: number;
  strength: number;
}

const namePattern = /\p{L}[\p{L}\p{M}]*(?:[-'’‐‑]\p{L}[\p{L}\p{M}]*)*/gu;
const coursePattern = /(?<![\p{L}\p{N}])[A-Z]{2,5}(?: +| *- *)?\d{3}[A-Z]{0,2}(?![\p{L}\p{N}])/giu;
const meetingTime = /\b\d{1,2}:\d{2}\s*(?:[AP]M)?\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:[AP]M)?[ \t]+$/i;
const metadataLabel = /^\s*(?:location|room|building|days(?:\s*\/\s*time)?|time)\b(\s*:)?/i;
const instructorLabel = /\b(?:instructors?|professor|faculty|teacher)\b[^\S\t]*(?::|(?=\s|$))/i;
const instructorHeading = /^(?:instructors?|professor|faculty|teacher)\s*:?$/i;
const scheduleHeading = /^(?:course(?: (?:code|name|title))?|class|section|room|building|location|days?(?:\s*\/\s*time)?|time|title)\s*:?$/i;
const nameSuffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function normalizeName(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/’/g, "'").replace(/[‐‑]/g, '-');
}

function nameTokens(text: string): Token[] {
  return Array.from(text.matchAll(namePattern), ({ 0: word, index }) => ({
    value: normalizeName(word),
    start: index,
    end: index + word.length,
  }));
}

function courseTokens(line: string): Token[] {
  const courses: Token[] = [];
  for (const { 0: code, index } of line.matchAll(coursePattern)) {
    // Compact rows can put a building and room number directly after the meeting time.
    if (courses.length && meetingTime.test(line.slice(0, index))) continue;
    courses.push({ value: code.replace(/[ -]/g, '').toUpperCase(), start: index, end: index + code.length });
  }
  return courses;
}

function markPlaceholders(tokens: Token[]): void {
  for (const [i, token] of tokens.entries()) {
    if (token.value === 'staff' || token.value === 'tba') token.value = '';
    if (token.value === 'to' && tokens[i + 1]?.value === 'be' && tokens[i + 2]?.value === 'announced') {
      for (const part of tokens.slice(i, i + 3)) part.value = '';
    }
  }
}

function adjacent(line: string, from: number, to: number): boolean {
  return !/[\p{N}\t|]/u.test(line.slice(from, to));
}

function givenName(tokens: Token[], line: string, start: number, end: number, name: RosterName) {
  const before = tokens[start - 1];
  const lastStart = tokens[start]!.start;
  // The surname index excludes suffixes. Skip one in the paste before looking for a reversed given name.
  if (tokens[end] && nameSuffixes.has(tokens[end]!.value) && adjacent(line, tokens[end - 1]!.end, tokens[end]!.start)) {
    end++;
  }
  const lastEnd = tokens[end - 1]!.end;
  const after = tokens[end];
  const matches = (firstStart: number) => firstStart >= 0
    && name.first.every((word, i) => {
      const part = tokens[firstStart + i];
      return part?.value === word && (i === 0 || adjacent(line, tokens[firstStart + i - 1]!.end, part.start));
    });

  if (!name.first.length) return;

  const firstStart = start - name.first.length;
  const afterIsAdjacent = after && adjacent(line, lastEnd, after.start);
  const beforeIsAdjacent = before && adjacent(line, before.end, lastStart);
  const first = tokens[start - 2];
  const hasMiddleInitial = beforeIsAdjacent && /^\p{L}$/u.test(before.value)
    && first && adjacent(line, first.end, before.start);
  if (afterIsAdjacent && matches(end)) {
    return { strength: 3, start, end: end + name.first.length };
  }
  if (beforeIsAdjacent && matches(firstStart)) {
    return { strength: 3, start: firstStart, end };
  }
  if (hasMiddleInitial && matches(firstStart - 1)) {
    return { strength: 3, start: firstStart - 1, end };
  }
  if (afterIsAdjacent && after.value === name.first[0]) return { strength: 2, start, end: end + 1 };
  if (beforeIsAdjacent && before.value === name.first[0]) return { strength: 2, start: start - 1, end };
  if (hasMiddleInitial && first.value === name.first[0]) return { strength: 2, start: start - 2, end };
  if (afterIsAdjacent && after.value === name.initial) {
    return { strength: 1, start, end: end + 1 };
  }
  if (beforeIsAdjacent && before.value === name.initial) {
    return { strength: 1, start: start - 1, end };
  }
}

function* lineMatches(line: string, tokens: Token[], byLastName: Map<string, RosterName[]>, maxLastWords: number): Generator<LineMatch> {
  for (let start = 0; start < tokens.length; start++) {
    let last = '';
    for (let end = start + 1; end <= Math.min(tokens.length, start + maxLastWords); end++) {
      const part = tokens[end - 1]!;
      if (!part.value || (end > start + 1 && !adjacent(line, tokens[end - 2]!.end, part.start))) break;
      last = last ? `${last} ${part.value}` : part.value;
      const names = byLastName.get(last);
      if (!names) continue;

      const evidence = names.map((name) => ({ prof: name.prof, match: givenName(tokens, line, start, end, name) }));
      const strength = evidence.reduce((max, { match }) => Math.max(max, match?.strength ?? 0), 1);
      const strongest = evidence.filter(({ match }) => match?.strength === strength);
      const candidates = (strongest.length ? strongest : evidence).map(({ prof }) => prof);
      const confidence = candidates.length > 1 ? 'ambiguous' : strongest.length ? 'confident' : 'possible';
      const snippet = strongest[0]?.match ?? { start, end };
      yield { candidates, confidence, start: snippet.start, end: snippet.end, surnameStart: start, surnameEnd: end, strength };
    }
  }
}

function instructorFields(line: string, fields: string[], columns: number[], label: RegExpMatchArray | null) {
  if (columns.length) {
    let offset = 0;
    return fields.flatMap((field, column) => {
      const start = offset;
      offset += field.length + 1;
      return columns.includes(column) ? [{ start, end: start + field.length }] : [];
    });
  }
  if (label) return [{ start: (label.index ?? 0) + label[0].length, end: line.length }];
  return [];
}

function scheduleLines(text: string) {
  const lines = text.split(/\r\n?|\n/).map((line) => {
    const separator = line.includes('\t') ? '\t' : '|';
    const fields = line.split(separator);
    const metadata = line.match(metadataLabel);
    const match = metadata ? null : line.match(instructorLabel);
    const label = match && (match[0].endsWith(':') || !line.slice(0, match.index).trim()) ? match : null;
    const headings = fields.length > 1
      ? fields.flatMap((field, column) => instructorHeading.test(field.trim()) ? [column] : []) : [];
    // A colon followed by a tab may label a single name, even though it looks like a two-cell header.
    const firstHeading = headings[0];
    const labeledName = label?.[0].endsWith(':') && firstHeading !== undefined
      && fields.slice(0, firstHeading).every((field) => !field.trim())
      && !fields.slice(firstHeading + 1).some((field) => scheduleHeading.test(field.trim()));
    return { line, separator, fields, headings: labeledName ? [] : headings, metadata, label, labeledName };
  });

  const hasInstructors = lines.some(({ label, headings }) => label || headings.length);
  let table: { separator: string; width: number; columns: number[] } | undefined;
  const rows = lines.flatMap(({ line, separator, fields, headings, metadata, label, labeledName }) => {
    if (headings.length) {
      table = { separator, width: fields.length, columns: headings };
      return [];
    }
    const columns = !labeledName && table?.separator === separator && table.width === fields.length ? table.columns : [];
    if (metadata && (!columns.length || metadata[1])) return [];
    const names = instructorFields(line, fields, columns, label);
    return [{ line, names, inTable: columns.length > 0 }];
  });
  return { hasInstructors, rows };
}

const honorific = /^(?:(?:dr|prof(?:essor)?|mr|mrs|ms|miss|mx)\.?\s+)+/i;
const suffixAtEnd = /(?:[, ]+)(?:jr|sr|ii|iii|iv|v)\.?$/i;
const placeholderName = /^(?:staff|tba|to be announced)\.?$/i;
const scheduleWord = /^(?:course|class|section|instructors?|professor|faculty|teacher|room|building|location|days?|time|title|lec(?:ture)?|lab|seminar|discussion|online|remote|campus|hall|am|pm|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|staff|tba)$/i;
const meetingDays = /^(?:(?:Mo|Tu|We|Th|Fr|Sa|Su){2,}|[MTWRFSU]{2,})$/;

function searchName(field: string): string {
  const clean = (part: string) => part.trim().replace(honorific, '').replace(suffixAtEnd, '');
  const text = field.trim().replace(/\s+/g, ' ');
  const comma = text.indexOf(',');
  const afterComma = comma >= 0 ? text.slice(comma + 1).trim() : '';
  const name = afterComma && !nameSuffixes.has(normalizeName(afterComma.replace(/\.$/, '')))
    ? `${clean(afterComma)} ${clean(text.slice(0, comma))}`.trim() : clean(text);
  return placeholderName.test(name) ? '' : name;
}

function* unstructuredNames(line: string): Generator<string> {
  const courses = courseTokens(line);
  // Wide spaces and cell separators usually delimit columns in a copied schedule.
  for (const { 0: cell, index } of line.matchAll(/[^\t|]+?(?= {2,}|[\t|]|$)/g)) {
    if (/^\s*to\s+be\s+announced\s*$/i.test(cell) || /\b(?:hall|building|campus)\b/i.test(cell)) continue;
    let words: string[] = [];
    let previousEnd = 0;
    for (const { 0: word, index: start } of cell.matchAll(namePattern)) {
      const end = start + word.length;
      const offset = index + start;
      const atNumber = /\d/.test(line[offset - 1] ?? '') || /\d/.test(cell[end] ?? '');
      const isNameWord = /^\p{Lu}/u.test(word) && !atNumber && !scheduleWord.test(word) && !meetingDays.test(word)
        && !courses.some((course) => course.start <= offset && offset < course.end);
      const isAdjacent = /^\.?\s+$/.test(cell.slice(previousEnd, start));
      if (!isNameWord || !isAdjacent || words.length === 3) {
        if (words.length >= 2) yield words.join(' ');
        words = [];
      }
      if (isNameWord) words.push(word.length === 1 && cell[end] === '.' ? word + '.' : word);
      previousEnd = end;
    }
    if (words.length >= 2) yield words.join(' ');
  }
}

export function nameQueries(text: string): string[] {
  const { hasInstructors, rows } = scheduleLines(text);
  const queries = new Map<string, string>();
  for (const { line, names } of rows) {
    const fields = hasInstructors ? names.map(({ start, end }) => line.slice(start, end)) : unstructuredNames(line);
    for (const field of fields) {
      const name = searchName(field);
      const key = name.toLowerCase();
      if (name && !queries.has(key)) queries.set(key, name);
      if (queries.size === 20) return [...queries.values()];
    }
  }
  return [...queries.values()];
}

function selectLineMatches(
  line: string, tokens: Token[], byLastName: Map<string, RosterName[]>, maxLastWords: number,
  weakFields: { start: number; end: number }[],
) {
  const selected: LineMatch[] = [];
  let remaining = [...lineMatches(line, tokens, byLastName, maxLastWords)];
  while (true) {
    const confident = remaining.filter(({ confidence }) => confidence === 'confident')
      .sort((a, b) => b.strength - a.strength || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    if (!confident.length) break;
    for (const match of confident) {
      const parts = tokens.slice(match.start, match.end);
      if (parts.some(({ value }) => !value)) continue;
      for (const part of parts) part.value = '';
      selected.push(match);
    }
    // Removing a confident name can resolve a neighboring ambiguous match.
    remaining = [...lineMatches(line, tokens, byLastName, maxLastWords)];
  }

  const weak = remaining.filter((match) => weakFields.some(({ start, end }) =>
    start <= tokens[match.start]!.start && tokens[match.end - 1]!.end <= end))
    .sort((a, b) => a.surnameStart - b.surnameStart || b.surnameEnd - a.surnameEnd);
  let nextSurname = 0;
  for (const match of weak) {
    if (match.surnameStart < nextSurname) continue;
    selected.push(match);
    nextSurname = match.surnameEnd;
  }
  return selected.sort((a, b) => a.start - b.start);
}

export function matchSchedule(text: string, roster: RosterProf[]): ScheduleMatch[] {
  const byLastName = new Map<string, RosterName[]>();
  const indexedIds = new Set<number>();
  let maxLastWords = 0;
  for (const prof of roster) {
    const last = prof.lastName.match(namePattern)?.map(normalizeName) ?? [];
    if (last.length > 1 && nameSuffixes.has(last.at(-1)!)) last.pop();
    if (!last.length || indexedIds.has(prof.rmpId)) continue;
    indexedIds.add(prof.rmpId);
    const key = last.join(' ');
    const first = prof.firstName.match(namePattern)?.map(normalizeName) ?? [];
    const name = { prof, first, initial: Array.from(first[0] ?? '')[0] ?? '' };
    const names = byLastName.get(key);
    if (names) names.push(name);
    else byLastName.set(key, [name]);
    maxLastWords = Math.max(maxLastWords, last.length);
  }

  const results = new Map<number | string, ScheduleMatch>();
  const { hasInstructors, rows } = scheduleLines(text);
  let previousCourse: string | undefined;
  for (const { line, names, inTable } of rows) {
    const weakFields = hasInstructors ? names : [{ start: 0, end: line.length }];
    const courses = courseTokens(line);
    const tokens = nameTokens(line);
    markPlaceholders(tokens);
    for (const token of tokens) {
      if (courses.some(({ start, end }) => start <= token.start && token.start < end)) token.value = '';
    }

    const nameLine = inTable ? line : line.replace(/[\t|]/g, ' ');
    for (const { candidates, confidence, start, end } of selectLineMatches(nameLine, tokens, byLastName, maxLastWords, weakFields)) {
      const snippetStart = tokens[start]!.start;
      const snippetEnd = tokens[end - 1]!.end;
      const matchedText = line.slice(snippetStart, snippetEnd);
      const course = courses.findLast((item) => item.end <= snippetStart)?.value
        ?? previousCourse ?? courses.find((item) => item.start >= snippetEnd)?.value;

      // A repeated unresolved candidate set gets one row, just like a repeated professor ID.
      const key = candidates.length === 1 ? candidates[0]!.rmpId : candidates.map((p) => p.rmpId).join(',');
      const existing = results.get(key);
      if (!existing) results.set(key, { candidates, confidence, matchedText, course });
      else {
        existing.course ??= course;
        if (existing.confidence === 'possible' && confidence === 'confident') {
          existing.confidence = confidence;
          existing.matchedText = matchedText;
        }
      }
    }
    previousCourse = courses.at(-1)?.value ?? previousCourse;
  }
  return [...results.values()];
}

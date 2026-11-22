import { fullName, matchSchedule, nameQueries, type ScheduleMatch } from './match';
import { send, type Reply } from './messaging';
import { parseSchoolLink } from './rmp';
import { termChoices } from './terms';
import type { AppState, Msg, RosterProf, RosterProgress, School, TrackManyItem } from './types';
import { h } from './ui';

interface ReviewRow extends ScheduleMatch {
  selected: RosterProf | null;
}

function lastNameWord(name: string): string {
  const words = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/’/g, "'").replace(/[‐‑]/g, '-').match(/\p{L}+(?:[-']\p{L}+)*/gu) ?? [];
  const last = words.at(-1) ?? '';
  return words.length > 1 && /^(?:jr|sr|ii|iii|iv|v)$/.test(last) ? words.at(-2)! : last;
}

export async function findScheduleMatches(text: string, roster: RosterProf[], onNameSearch: () => void) {
  const matches = matchSchedule(text, roster);
  const matchedNames = new Set(matches.flatMap(({ confidence, candidates }) =>
    confidence === 'ambiguous' ? [] : candidates.map((prof) => lastNameWord(prof.lastName))));
  const queries = nameQueries(text).filter((query) => !matchedNames.has(lastNameWord(query))).slice(0, 20);
  const merged = new Map(roster.map((prof) => [prof.rmpId, prof]));
  if (!queries.length) return { matches, searched: merged.size, error: '' };

  onNameSearch();
  let error = '';
  for (const query of queries) {
    const results = await send({ type: 'searchProfessors', text: query });
    if (!results.ok) {
      error = results.error;
      continue;
    }
    for (const prof of results.data as RosterProf[]) merged.set(prof.rmpId, prof);
  }
  return { matches: matchSchedule(text, [...merged.values()]), searched: merged.size, error };
}

export function createPastePanel(act: (msg: Msg) => Promise<Reply>) {
  let state: AppState | undefined;
  let choosingSchool = false;
  let busy = false;
  let rows: ReviewRow[] = [];
  let matchedSchedule: string | null = null;
  let searchScope = '';
  let choices = termChoices();

  const toggle = h('button', { class: 'primary', type: 'button', 'aria-controls': 'paste-panel', 'aria-expanded': 'false' }, 'Add professors');
  const schoolDetails = h('div', { class: 'paste-school' });
  const progress = h('div', { class: 'muted', role: 'status', hidden: true });
  const searchStatus = h('div', { class: 'muted', role: 'status', hidden: true });
  const wrongSchool = h('div', { class: 'muted', hidden: true }, 'Wrong school? ',
    h('button', { class: 'link', type: 'button', onclick: changeSchool }, 'Change it.'));
  const error = h('div', { class: 'err paste-error', role: 'alert', hidden: true });
  const textarea = h('textarea', { id: 'paste-schedule', rows: '4', placeholder: 'Paste your class schedule from your school portal' });
  const find = h('button', { class: 'primary', type: 'button', disabled: true, onclick: () => findProfessors() }, 'Find professors');
  const refresh = h('button', { class: 'link', type: 'button', onclick: () => findProfessors(true) }, 'Refresh list');
  const matches = h('div', { class: 'paste-matches' });
  const term = h('select', { id: 'paste-term' });
  const signIn = h('p', { class: 'muted' }, 'Sign in above to get email reminders.');
  const track = h('button', { class: 'primary', type: 'button', disabled: true, onclick: trackProfessors }, 'Track 0 professors');

  const schools = nameSearch<School>('paste-school', 'Find your school (name or Rate My Professors link)', 3, 'searchSchools',
    (school) => [school.name, schoolLocation(school)], pickSchool);
  const professors = nameSearch<RosterProf>('paste-professor', 'Add someone else', 1, 'searchProfessors',
    (prof) => [fullName(prof), professorDetails(prof)], addProfessor);

  const review = h('div', { class: 'paste-stack', hidden: true },
    matches,
    professors.element,
    h('div', {}, h('label', { for: term.id }, 'Term'), term),
    signIn,
    h('div', {}, track),
  );
  const composer = h('div', { class: 'paste-stack', hidden: true },
    h('div', {}, h('label', { for: textarea.id }, 'Class schedule'), textarea),
    h('div', { class: 'paste-actions' }, find),
    progress,
    searchStatus,
    h('div', { class: 'paste-actions' }, wrongSchool, refresh),
    review,
  );
  const panel = h('div', { id: 'paste-panel', class: 'paste-stack', hidden: true }, schoolDetails, schools.element, composer, error);
  const element = h('section', { class: 'paste-section', hidden: true }, toggle, panel);

  resetTerms();
  textarea.addEventListener('input', () => {
    find.disabled = busy || !textarea.value.trim();
    review.hidden = textarea.value !== matchedSchedule;
    renderSearchStatus();
    updateTrackButton();
  });
  term.addEventListener('change', renderMatches);
  toggle.addEventListener('click', () => {
    setOpen(panel.hidden === true);
    if (panel.hidden) return;
    if (choosingSchool || !state?.school) {
      if (!schools.input.value) schools.setText(state?.professors[0]?.school ?? '');
      schools.input.focus();
    } else {
      textarea.focus();
    }
  });

  function setOpen(open: boolean) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  function setError(message = '', fallback = false) {
    error.hidden = !message;
    error.textContent = message + (fallback && message ? ' You can still open a professor’s Rate My Professors page and click Track.' : '');
  }

  function setBusy(value: boolean) {
    busy = value;
    textarea.disabled = value;
    find.disabled = value || !textarea.value.trim();
    refresh.disabled = value;
    term.disabled = value;
    schools.input.disabled = value;
    professors.input.disabled = value;
    renderSchool();
    renderMatches();
  }

  function renderSchool() {
    const school = state?.school;
    const showSearch = choosingSchool || !school;
    schools.element.hidden = !showSearch;
    composer.hidden = showSearch;
    schoolDetails.replaceChildren();
    schoolDetails.hidden = !school;
    if (!school) return;
    const location = schoolLocation(school);
    schoolDetails.append(
      h('div', {}, h('strong', {}, school.name), location && h('div', { class: 'muted' }, location)),
      h('button', { class: 'link', type: 'button', disabled: busy, onclick: changeSchool }, choosingSchool ? 'Cancel' : 'Change'),
    );
  }

  function changeSchool() {
    if (busy || !state?.school) return;
    choosingSchool = !choosingSchool;
    setError();
    renderSchool();
    schools.setText(choosingSchool ? state.school.name : '');
    if (choosingSchool) schools.input.focus();
    else textarea.focus();
  }

  async function pickSchool(school: School) {
    if (busy) return;
    const previousSchool = state?.school?.id;
    setError();
    setBusy(true);
    try {
      const reply = await act({ type: 'setSchool', school });
      if (!reply.ok) {
        setError(reply.error);
        return;
      }
      choosingSchool = false;
      schools.setText('');
      if (previousSchool !== school.id) clearReview();
    } catch (e) {
      console.warn('[ProfNudge]', e);
      setError('Couldn’t save your school. Try again.');
    } finally {
      setBusy(false);
      if (!composer.hidden && !panel.hidden) textarea.focus();
    }
  }

  async function findProfessors(force = false) {
    const school = state?.school;
    const text = textarea.value;
    if (busy || !school || (!force && !text.trim())) return;
    setError();
    setBusy(true);
    professors.setText('');
    progress.hidden = false;
    progress.textContent = 'Loading professors…';
    const onProgress = (msg: RosterProgress) => {
      if (msg.type !== 'rosterProgress') return;
      const loaded = msg.loaded.toLocaleString();
      progress.textContent = `Loading professors… ${loaded}${msg.total ? ` / ${msg.total.toLocaleString()}` : ''}`;
    };
    browser.runtime.onMessage.addListener(onProgress);
    try {
      const reply = await send({ type: 'loadRoster', force });
      if (!reply.ok) {
        setError(reply.error);
        return;
      }
      const roster = reply.data as RosterProf[];
      let searched = roster.length;
      if (text.trim()) {
        const result = await findScheduleMatches(text, roster, () => {
          progress.textContent = 'Searching for professors by name…';
        });
        searched = result.searched;
        if (result.error) setError(result.error);
        rows = result.matches.map((match) => ({
          ...match,
          selected: match.confidence === 'confident' ? match.candidates[0]! : null,
        }));
        matchedSchedule = text;
      }
      searchScope = `Searched ${searched.toLocaleString()} ${searched === 1 ? 'professor' : 'professors'} at ${school.name}`;
    } catch (e) {
      console.warn('[ProfNudge]', e);
      setError('Couldn’t load professors from Rate My Professors. Try again.', true);
    } finally {
      browser.runtime.onMessage.removeListener(onProgress);
      progress.hidden = true;
      setBusy(false);
    }
  }

  function alreadyTracked(prof: RosterProf) {
    return state?.professors.some((p) => p.rmpId === prof.rmpId && p.termKey === term.value) ?? false;
  }

  function updateTrackButton() {
    const count = toTrack().size;
    track.textContent = `Track ${count} ${count === 1 ? 'professor' : 'professors'}`;
    track.disabled = busy || count === 0;
  }

  function renderSearchStatus() {
    const noMatches = !busy && matchedSchedule !== null && textarea.value === matchedSchedule && rows.length === 0;
    searchStatus.hidden = busy || !searchScope;
    searchStatus.textContent = noMatches ? `No professors found in that text. ${searchScope}.` : searchScope;
    wrongSchool.hidden = !noMatches;
  }

  function renderMatches() {
    review.hidden = textarea.value !== matchedSchedule;
    signIn.hidden = Boolean(state?.email);
    matches.replaceChildren(...rows.map((row, index) => {
      const ambiguous = row.confidence === 'ambiguous';
      const candidates = row.candidates.map((prof) => {
        const tracked = alreadyTracked(prof);
        const input = h('input', {
          type: ambiguous ? 'radio' : 'checkbox',
          name: `paste-match-${index}`,
          checked: !tracked && row.selected?.rmpId === prof.rmpId,
          disabled: tracked || busy,
        });
        input.addEventListener('change', () => {
          row.selected = input.checked ? prof : null;
          updateTrackButton();
        });
        const details = [professorDetails(prof), row.course, tracked ? 'Already tracked' : undefined].filter(Boolean).join(' · ');
        return h('label', { class: tracked ? 'paste-candidate tracked' : 'paste-candidate' },
          input,
          h('span', {}, h('strong', {}, fullName(prof)), h('span', { class: 'muted' }, details)),
        );
      });
      if (ambiguous) return h('fieldset', {}, h('legend', {}, `Choose a match for “${row.matchedText}”`), ...candidates);
      const possible = row.confidence === 'possible';
      return h('div', {}, candidates[0]!, possible && h('div', { class: 'muted paste-possible' }, 'Possible match'));
    }));
    renderSearchStatus();
    updateTrackButton();
  }

  function addProfessor(prof: RosterProf) {
    if (busy) return;
    const match = rows.find((row) => row.candidates.some((candidate) => candidate.rmpId === prof.rmpId));
    if (match && (match.confidence !== 'ambiguous' || !match.selected || match.selected.rmpId === prof.rmpId)) {
      match.selected = prof;
    } else {
      if (match) match.candidates = match.candidates.filter((candidate) => candidate.rmpId !== prof.rmpId);
      rows.push({
        candidates: [prof],
        confidence: 'confident',
        matchedText: fullName(prof),
        course: match?.course,
        selected: prof,
      });
    }
    professors.setText('');
    renderMatches();
    professors.input.focus();
  }

  function toTrack() {
    const profs = new Map<number, TrackManyItem>();
    const school = state?.school;
    if (!school || textarea.value !== matchedSchedule) return profs;
    for (const { selected, course } of rows) {
      if (!selected || alreadyTracked(selected)) continue;
      const rmpId = selected.rmpId;
      const existing = profs.get(rmpId);
      if (!existing || (!existing.course && course)) {
        profs.set(rmpId, { rmpId, name: fullName(selected), school: school.name, course });
      }
    }
    return profs;
  }

  async function trackProfessors() {
    const pickedTerm = state?.terms.find((choice) => choice.key === term.value) ?? choices.find((choice) => choice.key === term.value);
    if (busy || !pickedTerm) return;
    const profs = [...toTrack().values()];
    if (!profs.length) return;
    setError();
    setBusy(true);
    try {
      const reply = await act({ type: 'trackMany', profs, term: pickedTerm });
      if (!reply.ok) {
        setError(reply.error);
        return;
      }
      setOpen(false);
      toggle.focus();
      textarea.value = '';
      clearReview();
      resetTerms();
    } catch (e) {
      console.warn('[ProfNudge]', e);
      setError('Couldn’t track your professors. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function clearReview() {
    matchedSchedule = null;
    searchScope = '';
    rows = [];
    professors.setText('');
  }

  function resetTerms() {
    choices = termChoices();
    term.replaceChildren(...choices.map((choice) => h('option', { value: choice.key }, choice.label)));
  }

  function nameSearch<T>(
    id: string,
    label: string,
    minimum: number,
    type: 'searchSchools' | 'searchProfessors',
    describe: (item: T) => [string, string],
    pick: (item: T) => void,
  ) {
    const isSchoolSearch = type === 'searchSchools';
    const hint = isSchoolSearch && h('p', { id: `${id}-hint`, class: 'muted' },
      "Can't find your school? Paste its Rate My Professors link (e.g. ratemyprofessors.com/school/163).");
    const input = h('input', { id, type: 'search', autocomplete: 'off', ...(hint && { 'aria-describedby': hint.id }) });
    const results = h('div', { class: 'paste-results', 'aria-label': `${label} results` });
    const status = h('div', { class: 'muted', role: 'status' });
    let timer: ReturnType<typeof setTimeout>;
    let request = 0;

    function scheduleSearch() {
      const current = ++request;
      clearTimeout(timer);
      results.replaceChildren();
      status.textContent = '';
      setError();
      const text = input.value.trim();
      const legacyId = isSchoolSearch ? parseSchoolLink(text) : null;
      if (legacyId === null && text.length < minimum) return;

      async function search() {
        status.textContent = 'Searching…';
        try {
          const reply = await send(legacyId === null ? { type, text } : { type: 'schoolById', legacyId });
          if (request !== current) return;
          if (!reply.ok) {
            setError(reply.error);
            return;
          }
          const items = legacyId === null ? (reply.data as T[]).slice(0, 10) : [reply.data as T];
          const emptyMessage = isSchoolSearch
            ? `No schools match “${text}”. Try fewer words, or paste your school's Rate My Professors link.`
            : 'No results found.';
          status.textContent = items.length ? '' : emptyMessage;
          results.replaceChildren(...items.map((item) => {
            const [name, details] = describe(item);
            return h('button', { type: 'button', onclick: () => pick(item) }, name, details && h('span', { class: 'muted' }, details));
          }));
        } catch (e) {
          console.warn('[ProfNudge]', e);
          if (request === current) setError('Couldn’t search Rate My Professors. Try again.', true);
        } finally {
          if (request === current && status.textContent === 'Searching…') status.textContent = '';
        }
      }

      if (legacyId === null) timer = setTimeout(search, 300);
      else void search();
    }

    input.addEventListener('input', scheduleSearch);
    return {
      element: h('div', {}, h('label', { for: id }, label), input, hint, status, results),
      input,
      setText(text: string) {
        input.value = text;
        scheduleSearch();
      },
    };
  }

  function schoolLocation(school: School) {
    return [school.city, school.state].filter(Boolean).join(', ');
  }

  function professorDetails(prof: RosterProf) {
    return [prof.department, `${prof.numRatings} ${prof.numRatings === 1 ? 'rating' : 'ratings'}`].filter(Boolean).join(' · ');
  }

  return {
    element,
    update(st: AppState) {
      state = st;
      element.hidden = false;
      renderSchool();
      renderMatches();
    },
  };
}

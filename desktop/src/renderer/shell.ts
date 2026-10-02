// Shell (barra superior + pantallas). Script clasico (sin imports): asi no depende de privilegios del protocolo file://.
interface SavedInfo { sessionId: number; studentName: string; examTitle: string; branch: string }
interface Step { id: string; label: string; status: 'pending' | 'running' | 'ok' | 'error'; detail?: string }
type AppState =
  | { screen: 'start'; saved: SavedInfo | null }
  | { screen: 'progress'; steps: Step[] }
  | { screen: 'error'; title: string; message: string; logs?: string; canRetry: boolean }
  | { screen: 'workspace'; student: string; exam: string; tab: 'IDE' | 'APP'; appUp: boolean; port: number }
  | { screen: 'closing' };

declare const assessment: {
  listStudents(): Promise<{ id: number; name: string }[]>;
  listExams(): Promise<{ id: number; title: string }[]>;
  getSaved(): Promise<SavedInfo | null>;
  start(studentId: number, examId: number): Promise<void>;
  resume(): Promise<void>;
  newSession(): Promise<void>;
  retry(): Promise<void>;
  switchTab(tab: 'IDE' | 'APP'): Promise<void>;
  reload(): Promise<void>;
  quit(): Promise<void>;
  onState(cb: (s: AppState) => void): void;
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const SECTIONS = ['start', 'progress', 'error', 'closing', 'app-placeholder'];
const ICON: Record<Step['status'], string> = { pending: '○', running: '⏳', ok: '✓', error: '✗' };

function show(id: string | null): void {
  for (const s of SECTIONS) $(s).hidden = s !== id;
}

async function fillForm(): Promise<void> {
  try {
    const [students, exams] = await Promise.all([assessment.listStudents(), assessment.listExams()]);
    $<HTMLSelectElement>('student').innerHTML = students.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    $<HTMLSelectElement>('exam').innerHTML = exams.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join('');
    $('form-error').textContent = '';
    $<HTMLButtonElement>('begin').disabled = false;
  } catch {
    $('form-error').textContent = 'No se puede conectar con el servidor de la plataforma';
    $<HTMLButtonElement>('begin').disabled = true;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function render(state: AppState): void {
  $('bar').hidden = state.screen !== 'workspace';
  switch (state.screen) {
    case 'start': {
      show('start');
      $('resume-card').hidden = !state.saved;
      $('form').hidden = !!state.saved;
      if (state.saved) {
        $('resume-text').textContent = `Retomar: ${state.saved.studentName} · ${state.saved.examTitle} (rama ${state.saved.branch})`;
      } else {
        void fillForm();
      }
      break;
    }
    case 'progress': {
      show('progress');
      $('steps').innerHTML = state.steps
        .map((s) => `<li data-step="${s.id}" data-status="${s.status}"><span>${ICON[s.status]}</span><span>${esc(s.label)}${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ''}</span></li>`)
        .join('');
      break;
    }
    case 'error': {
      show('error');
      $('error-title').textContent = state.title;
      $('error-message').textContent = state.message;
      $('error-details').hidden = !state.logs;
      $('error-logs').textContent = state.logs ?? '';
      $('retry').textContent = state.title === 'El entorno se detuvo' ? 'Reiniciar' : 'Reintentar';
      $('retry').hidden = !state.canRetry;
      break;
    }
    case 'closing':
      show('closing');
      break;
    case 'workspace': {
      $('who').innerHTML = `${esc(state.student)} · ${esc(state.exam)} · <span class="dot">●</span> activa`;
      $('tab-ide').classList.toggle('active', state.tab === 'IDE');
      $('tab-app').classList.toggle('active', state.tab === 'APP');
      show(state.tab === 'APP' && !state.appUp ? 'app-placeholder' : null);
      break;
    }
  }
}

$<HTMLFormElement>('form').addEventListener('submit', (e) => {
  e.preventDefault();
  void assessment.start(Number($<HTMLSelectElement>('student').value), Number($<HTMLSelectElement>('exam').value));
});
$('resume').addEventListener('click', () => void assessment.resume());
$('other').addEventListener('click', (e) => { e.preventDefault(); void assessment.newSession(); });
$('retry').addEventListener('click', () => void assessment.retry());
$('error-quit').addEventListener('click', () => void assessment.quit());
$('quit').addEventListener('click', () => void assessment.quit());
$('reload').addEventListener('click', () => void assessment.reload());
$('tab-ide').addEventListener('click', () => void assessment.switchTab('IDE'));
$('tab-app').addEventListener('click', () => void assessment.switchTab('APP'));

assessment.onState(render);

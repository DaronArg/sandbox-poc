import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { Controller } from './controller';
import { Tab } from './views';

/** Cada handler valida que el mensaje venga del frame del shell (design §7.7). */
export function registerIpc(controller: Controller, shellUrl: () => string): void {
  const guard = (e: IpcMainInvokeEvent): void => {
    const url = e.senderFrame?.url ?? '';
    if (url !== shellUrl()) throw new Error('IPC rechazado: origen no autorizado');
  };
  const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (e, ...args) => { guard(e); return fn(...args); });
  };

  handle('listStudents', () => controller.listStudents());
  handle('listExams', () => controller.listExams());
  handle('getSaved', () => controller.getSaved());
  handle('getState', () => controller.getState());
  handle('start', (studentId: unknown, examId: unknown) => {
    if (!Number.isInteger(studentId) || !Number.isInteger(examId)) throw new Error('parametros invalidos');
    return controller.start(studentId as number, examId as number);
  });
  handle('resume', () => controller.resume());
  handle('newSession', () => controller.newSession());
  handle('retry', () => controller.retry());
  handle('switchTab', (tab: unknown) => {
    if (tab !== 'IDE' && tab !== 'APP') throw new Error('pestana invalida');
    controller.switchTab(tab as Tab);
  });
  handle('reload', () => controller.reload());
  handle('submit', () => controller.submit());
  handle('quit', () => controller.quit());
}

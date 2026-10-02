import { contextBridge, ipcRenderer } from 'electron';

// API minima del shell (design §7.7): nada de ipcRenderer ni de Node expuesto a la pagina.
contextBridge.exposeInMainWorld('assessment', {
  listStudents: () => ipcRenderer.invoke('listStudents'),
  listExams: () => ipcRenderer.invoke('listExams'),
  getSaved: () => ipcRenderer.invoke('getSaved'),
  start: (studentId: number, examId: number) => ipcRenderer.invoke('start', studentId, examId),
  resume: () => ipcRenderer.invoke('resume'),
  newSession: () => ipcRenderer.invoke('newSession'),
  retry: () => ipcRenderer.invoke('retry'),
  switchTab: (tab: 'IDE' | 'APP') => ipcRenderer.invoke('switchTab', tab),
  reload: () => ipcRenderer.invoke('reload'),
  submit: () => ipcRenderer.invoke('submit'),
  quit: () => ipcRenderer.invoke('quit'),
  onState: (cb: (state: unknown) => void) => {
    ipcRenderer.on('state', (_e, s) => cb(s));
    void ipcRenderer.invoke('getState').then(cb); // estado actual al suscribirse
  },
});

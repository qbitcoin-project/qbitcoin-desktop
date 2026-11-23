import { contextBridge, ipcRenderer } from 'electron'
import { PROBE_COMMAND, PROBE_STATE, type ProbeBridge, type ProbeState } from '../shared/touchIdProbe'

const bridge: ProbeBridge = {
  run: (command) => ipcRenderer.invoke(PROBE_COMMAND, command),
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, state: ProbeState) => listener(state)
    ipcRenderer.on(PROBE_STATE, receive)
    return () => ipcRenderer.removeListener(PROBE_STATE, receive)
  },
}
contextBridge.exposeInMainWorld('touchIdProbe', bridge)
